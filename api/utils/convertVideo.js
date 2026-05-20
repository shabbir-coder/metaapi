const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegPath);

function convertVideoToWhatsApp(inputPath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath);
    const outputPath = inputPath.replace(ext, "_wa.mp4");

    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-pix_fmt yuv420p",
        "-profile:v baseline",
        "-level 3.0",
        "-movflags +faststart"
      ])
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

module.exports = convertVideoToWhatsApp;
