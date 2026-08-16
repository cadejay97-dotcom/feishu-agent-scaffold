import { mkdir, writeFile } from "node:fs/promises";
import { appHtml } from "../dist/control/ui.js";

const localApi = process.env.FEISHU_CONTROL_LOCAL_API || "http://127.0.0.1:4318";
const apiOrigin = new URL(localApi).origin;
if (!apiOrigin.startsWith("http://127.0.0.1:") && !apiOrigin.startsWith("http://localhost:")) {
  throw new Error("FEISHU_CONTROL_LOCAL_API must point to a loopback HTTP origin");
}

const bootstrap = `<script>window.__FEISHU_API_BASE__=${JSON.stringify(apiOrigin)}</script>`;
const hostedHtml = appHtml.replace("</head>", `${bootstrap}</head>`);
await mkdir("public", { recursive: true });
await writeFile("public/index.html", hostedHtml, "utf8");
console.log(`Built hosted control UI for local connector ${apiOrigin}`);
