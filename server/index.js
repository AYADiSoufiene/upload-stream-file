const express = require("express");
const multer = require("multer");
const zlib = require("zlib");
const { Transform, PassThrough, pipeline, Readable } = require("stream");
const cors = require("cors");
const fs = require("fs");
const archiver = require("archiver");

const app = express();
const PORT = 3000;
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });
const progressStream = new PassThrough();

// Helper: Initialize streams for gender-based CSV processing
function initializeGenderStreams() {
  const maleStream = new PassThrough();
  const femaleStream = new PassThrough();
  const maleGzipStream = zlib.createGzip();
  const femaleGzipStream = zlib.createGzip();

  maleStream
    .pipe(maleGzipStream)
    .pipe(fs.createWriteStream("./gzip/male.csv.gz"));
  femaleStream
    .pipe(femaleGzipStream)
    .pipe(fs.createWriteStream("./gzip/female.csv.gz"));

  return { maleStream, femaleStream, maleGzipStream, femaleGzipStream };
}

// Helper: Send progress updates
function updateProgress(type, value) {
  progressStream.write(`data: {"${type}": ${value.toFixed(2)}}\n\n`);
}

// Helper: Cleanup streams
function cleanupStreams(...streams) {
  streams.forEach((stream) => stream.destroy());
}

// File Upload Endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  const { maleStream, femaleStream, maleGzipStream, femaleGzipStream } =
    initializeGenderStreams();
  let headers = null;
  let totalSize = parseInt(req.headers["content-length"], 10);
  let processedSize = 0;
  const fileStream = Readable.from(req.file.buffer);
  const totalBytes = req.file.buffer.byteLength;

  const splitterTransform = new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    remainingData: "",
    transform(chunk, encoding, callback) {
      processedSize += chunk.length;
      updateProgress("upload", (processedSize / totalBytes) * 100);

      let start = 0;

      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) { // ASCII value of '\n'
          updateProgress("parsing", (i / totalBytes) * 100);
          const lineBuffer = chunk.slice(start, i);
          const line = this.remainingData
            ? this.remainingData + lineBuffer.toString()
            : lineBuffer.toString();
          this.remainingData = "";

          if (!headers) {
            headers = line.split(",");
            const headerLine = headers.join(",") + "\n";
            maleStream.write(headerLine);
            femaleStream.write(headerLine);
          } else {
            const columns = line.split(",");
            const genderIndex = headers.indexOf("gender");
            if (columns[genderIndex] === "male") maleStream.write(line + "\n");
            else if (columns[genderIndex] === "female")
              femaleStream.write(line + "\n");
          }

          start = i + 1;
        }
      }

      this.remainingData += chunk.slice(start).toString();

      callback();
    },
    flush(callback) {
      if (this.remainingData) {
        const columns = this.remainingData.split(",");
        const genderIndex = headers.indexOf("gender");
        if (columns[genderIndex] === "male")
          maleStream.write(this.remainingData + "\n");
        else if (columns[genderIndex] === "female")
          femaleStream.write(this.remainingData + "\n");
      }

      updateProgress("parsing", 100);
      maleStream.end();
      femaleStream.end();
      callback();
    },
  });

  // Track Gzip progress
  [maleGzipStream, femaleGzipStream].forEach((gzipStream, index) => {
    const type = index === 0 ? "gzipMale" : "gzipFemale";
    gzipStream.on("data", (chunk) =>
      updateProgress(type, (gzipStream.bytesWritten / processedSize) * 100)
    );
    gzipStream.on("end", () => updateProgress(type, 100));
  });

  pipeline(fileStream, splitterTransform, (err) => {
    if (err) {
      console.error("Pipeline failed:", err);
      cleanupStreams(
        maleStream,
        femaleStream,
        maleGzipStream,
        femaleGzipStream,
        progressStream
      );
      return res.status(500).send("File processing failed");
    }
    console.log("File processed successfully");
    sendFilesToClient(res, maleGzipStream, femaleGzipStream);
  });
});

function sendFilesToClient(res, maleGzipStream, femaleGzipStream) {
  const zipStream = archiver("zip", { zlib: { level: 9 } });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=processed-files.zip"
  );

  zipStream.pipe(res);
  zipStream.append(maleGzipStream, { name: "male.csv.gz" });
  zipStream.append(femaleGzipStream, { name: "female.csv.gz" });
  zipStream.finalize();

  zipStream.on("end", () => {
    console.log("ZIP file creation completed.");
    fs.unlinkSync("./gzip/male.csv.gz");
    fs.unlinkSync("./gzip/female.csv.gz");
  });
}

// SSE Progress Endpoint
app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  progressStream.pipe(res);
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
