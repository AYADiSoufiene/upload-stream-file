import { useState, useEffect, useRef } from "react";

interface Progress {
  upload: number;
  parsing: number;
  gzipMale: number;
  gzipFemale: number;
}

const App = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({
    upload: 0,
    parsing: 0,
    gzipMale: 0,
    gzipFemale: 0,
  });
  const [downloadLink, setDownloadLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Handle File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
    } else {
      setFile(null); // Handle the case where no file is selected
    }
  };

  // Start Upload
  const handleUpload = async () => {
    setProgress({
      upload: 0,
      parsing: 0,
      gzipMale: 0,
      gzipFemale: 0,
    });
    setDownloadLink(null);
    setError(null);

    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    // Start Upload
    try {
      const response = await fetch("http://localhost:3000/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file");
      }

      const blob = await response.blob();

      // Create a downloadable link
      const downloadUrl = URL.createObjectURL(blob);
      setDownloadLink(downloadUrl);
    } catch (err) {
      console.error("Upload failed:", err);
      setProgress({
        upload: 0,
        parsing: 0,
        gzipMale: 0,
        gzipFemale: 0,
      });
      setDownloadLink(null);
      setError("File processing failed");
    } finally {
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Listen for Progress Updates
  useEffect(() => {
    const eventSource = new EventSource("http://localhost:3000/progress");

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress((prev) => ({ ...prev, ...data }));
    };

    return () => eventSource.close();
  }, []);

  // Combined Progress
  const totalProgress = (
    (progress.upload +
      progress.parsing +
      progress.gzipMale +
      progress.gzipFemale) /
    4
  ).toFixed(2);

  return (
    <div>
      <h1>File Upload with Progress Tracking</h1>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
      />
      <button style={{ margin: "0 10px" }} onClick={handleUpload}>
        Upload
      </button>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {downloadLink ? (
        <a
          style={{ margin: "0 10px" }}
          href={downloadLink}
          download="processed-files.zip"
        >
          Download Processed File
        </a>
      ) : (
        <>
          <h3>Overall Progress: {totalProgress}%</h3>
          <div
            style={{
              border: "1px solid #ccc",
              width: "100%",
              marginTop: "10px",
            }}
          >
            <div
              style={{
                width: `${totalProgress}%`,
                backgroundColor: "green",
                height: "20px",
                transition: "width 0.5s",
              }}
            ></div>
          </div>
          <p>Upload Progress: {progress.upload}%</p>
          <p>Parsing Progress: {progress.parsing}%</p>
          <p>Male Gzip Progress: {progress.gzipMale}%</p>
          <p>Female Gzip Progress: {progress.gzipFemale}%</p>
        </>
      )}
    </div>
  );
};

export default App;
