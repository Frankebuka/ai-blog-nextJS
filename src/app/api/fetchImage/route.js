import axios from "axios";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const headers = new Headers();
    headers.append("Content-Type", response.headers["content-type"]);

    return new NextResponse(response.data, { headers });
  } catch (error) {
    console.error("Error fetching image:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
