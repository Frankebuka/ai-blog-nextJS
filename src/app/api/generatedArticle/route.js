import axios from "axios";
import FormData from "form-data";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

const downloadAudio = async (url, output) => {
  return new Promise((resolve, reject) => {
    const pythonExecutable = "python3"; // Use system Python
    const scriptPath = path.join(process.cwd(), "download_audio.py");
    exec(
      `${pythonExecutable} ${scriptPath} ${url} ${output}`,
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(output);
        }
      }
    );
  });
};

const uploadToAssemblyAI = async (filePath) => {
  const form = new FormData();
  form.append("audio", fs.createReadStream(filePath));

  const response = await axios.post(
    "https://api.assemblyai.com/v2/upload",
    form,
    {
      headers: {
        ...form.getHeaders(),
        authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY,
      },
    }
  );

  return response.data.upload_url;
};

const getTranscription = async (audioUrl) => {
  const response = await axios.post(
    "https://api.assemblyai.com/v2/transcript",
    { audio_url: audioUrl },
    { headers: { authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY } }
  );

  const { id } = response.data;

  let status = "processing";
  while (status === "processing" || status === "queued") {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const res = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      {
        headers: { authorization: process.env.NEXT_PUBLIC_ASSEMBLYAI_API_KEY },
      }
    );
    status = res.data.status;
    if (status === "completed") return res.data.text;
  }

  throw new Error("Transcription failed");
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  try {
    const videoId = getVideoIdFromUrl(url);
    const videoMeta = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          id: videoId,
          key: process.env.NEXT_PUBLIC_YOUTUBE_API_KEY,
          part: "snippet",
        },
      }
    );

    const { title, thumbnails } = videoMeta.data.items[0].snippet;
    const thumbnailUrl = thumbnails.high.url;

    const output = path.join(process.cwd(), "audio.mp3");
    await downloadAudio(url, output);
    const audioUrl = await uploadToAssemblyAI(output);
    const transcription = await getTranscription(audioUrl);

    return NextResponse.json({
      title,
      thumbnailUrl,
      transcription,
    });
  } catch (error) {
    console.error("Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const getVideoIdFromUrl = (url) => {
  const match = url.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/[^/]+\/|(?:v|e(?:mbed)?)\/|[^?]*[?](?:.*&)?v=|[^/]+\/(?:[^/]+\/)*)|youtu\.be\/)([^"&?/\s]{11})/
  );
  return match ? match[1] : null;
};
