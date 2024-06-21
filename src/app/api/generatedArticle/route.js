import express from "express";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.NEXT_PUBLIC_PORT || 4000;
const __dirname = path.resolve();

app.use(express.json());

const downloadAudio = async (url, output) => {
  return new Promise((resolve, reject) => {
    const pythonExecutable = "python3";
    const scriptPath = path.join(__dirname, "download_audio.py");
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

app.get("/download", async (req, res) => {
  const { url } = req.query;
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

    const output = path.join(__dirname, "audio.mp3");
    await downloadAudio(url, output);
    const audioUrl = await uploadToAssemblyAI(output);
    const transcription = await getTranscription(audioUrl);

    res.json({ title, thumbnailUrl, transcription });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("Error generating article");
  }
});

const getVideoIdFromUrl = (url) => {
  const match = url.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/[^/]+\/|(?:v|e(?:mbed)?)\/|[^?]*[?](?:.*&)?v=|[^/]+\/(?:[^/]+\/)*)|youtu\.be\/)([^"&?/\s]{11})/
  );
  return match ? match[1] : null;
};

app.get("/fetch-image", async (req, res) => {
  const { url } = req.query;
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.set("Content-Type", response.headers["content-type"]);
    res.send(response.data);
  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).send("Error fetching image");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
