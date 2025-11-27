import { Command } from "commander";
import http from "http";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .requiredOption("-h, --host <host>", "Server host")
  .requiredOption("-p, --port <port>", "Server port")
  .requiredOption("-c, --cache <dir>", "Cache directory path");

program.parse(process.argv);

const { host, port, cache } = program.opts();

if (!fs.existsSync(cache)) {
  fs.mkdirSync(cache, { recursive: true });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Server is running...");
});

server.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
});
