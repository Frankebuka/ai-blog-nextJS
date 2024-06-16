import ytdl from "ytdl-core";
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
// import ffmpegStatic from "ffmpeg-static";
import { PassThrough } from "stream";
import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  try {
    if (!ytdl.validateURL(url)) {
      throw new Error("Invalid YouTube URL");
    }

    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;
    const thumbnails = info.videoDetails.thumbnails;
    const thumbnailUrl = thumbnails[thumbnails.length - 1].url;

    // Download the audio
    const audioStream = ytdl(url, { filter: "audioonly" });
    const audioBuffer = await streamToBuffer(audioStream);

    // Detect the file type
    const type = await fileTypeFromBuffer(audioBuffer);

    // If the file type is not audio, re-encode it to MP3
    if (!type.mime.startsWith("audio/")) {
      const mp3Buffer = await reencodeToMP3(audioBuffer);
      const mp3Type = await fileTypeFromBuffer(mp3Buffer);

      if (mp3Type.mime !== "audio/mpeg") {
        throw new Error("Invalid audio file type after re-encoding");
      }

      const assemblyResponse = await sendToAssemblyAI(mp3Buffer, mp3Type);
      const transcriptId = assemblyResponse.data.id;

      const transcription = await getTranscription(transcriptId);

      return NextResponse.json({
        title,
        thumbnailUrl,
        text: transcription.text,
      });
    } else {
      const assemblyResponse = await sendToAssemblyAI(audioBuffer, type);
      const transcriptId = assemblyResponse.data.id;

      const transcription = await getTranscription(transcriptId);

      return NextResponse.json({
        title,
        thumbnailUrl,
        text: transcription.text,
      });
    }
  } catch (error) {
    console.error("Error downloading audio:", error.message);
    return new NextResponse("Error downloading audio", { status: 500 });
  }
}

const streamToBuffer = (stream) => {
  return new Promise((resolve, reject) => {
    const bufferArray = [];
    stream.on("data", (chunk) => bufferArray.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(bufferArray)));
    stream.on("error", reject);
  });
};

// Set ffmpeg path manually
const ffmpegPath = "/opt/homebrew/bin/ffmpeg";
ffmpeg.setFfmpegPath(ffmpegPath);

// // Set ffmpeg path from ffmpeg-static
// ffmpeg.setFfmpegPath(ffmpegStatic);

const reencodeToMP3 = (inputBuffer) => {
  return new Promise((resolve, reject) => {
    const outputStream = new PassThrough();
    const chunks = [];

    ffmpeg()
      .input(new PassThrough().end(inputBuffer))
      .outputFormat("mp3")
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)))
      .pipe(outputStream);

    outputStream.on("data", (chunk) => chunks.push(chunk));
    outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
};

const sendToAssemblyAI = async (audioBuffer, type) => {
  const formData = new FormData();
  formData.append("audio", audioBuffer, {
    filename: "audio.mp3",
    contentType: type.mime,
  });

  const uploadResponse = await axios.post(
    "https://api.assemblyai.com/v2/upload",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY,
      },
    }
  );

  const audioUrl = uploadResponse.data.upload_url;

  const transcriptionResponse = await axios.post(
    "https://api.assemblyai.com/v2/transcript",
    {
      audio_url: audioUrl,
    },
    {
      headers: {
        authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY,
      },
    }
  );

  return transcriptionResponse;
};

const getTranscription = async (transcriptId) => {
  let status = "processing";
  let transcription = null;

  while (status === "processing" || status === "queued") {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      {
        headers: {
          authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY,
        },
      }
    );

    status = response.data.status;
    transcription = response.data;

    if (status === "error") {
      console.error("Transcription error details:", transcription);
      throw new Error("Transcription failed");
    }
  }

  if (status === "completed") {
    return transcription;
  } else {
    throw new Error("Transcription failed");
  }
};
