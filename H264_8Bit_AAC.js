/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */

const details = () => ({
    id: 'nxCnnqhew',
    Stage: 'Pre-processing', // Preprocessing or Post-processing. Determines when the plugin will be executed.
    Name: 'Custom-Transcode to H264 8 Bit AAC using FFMPEG and NVENC/QSV/CPU ',
    Type: 'Video',
    Operation: 'Transcode',
    Description: `Files not in H264 8 Bit AAC will be transcoded into H264 8 Bit AAC using ffmpeg.`,
    Version: '1.00',
    Tags: 'pre-processing,ffmpeg,video only,nvenc h264,qsv h264,configurable',
    // Provide tags to categorise your plugin in the plugin browser.Tag options: h265,hevc,h264,nvenc h265,
    // nvenc h264,video only,audio only,subtitle only,handbrake,ffmpeg
    // radarr,sonarr,pre-processing,post-processing,configurable

    Inputs: [
      {
        name: 'container',
        type: 'string',
        defaultValue: 'mkv',
        inputUI: {
          type: 'text',
        },
        tooltip: `Specify output container of file 
                    \\n Ensure that all stream types you may have are supported by your chosen container.
                    \\n mkv is recommended.
                        \\nExample:\\n
                        mkv
  
                        \\nExample:\\n
                        mp4`,
      },
      {
        name: 'force_conform',
        type: 'string',
        defaultValue: 'false',
        inputUI: {
          type: 'text',
        },
        tooltip: `Make the file conform to output containers requirements.
                    \\n Drop hdmv_pgs_subtitle/eia_608/subrip/timed_id3 for MP4.
                    \\n Drop data streams/mov_text/eia_608/timed_id3 for MKV.
                    \\n Default is false.
                        \\nExample:\\n
                        true
    
                        \\nExample:\\n
                        false`,
      },
    ],
  });

  // eslint-disable-next-line no-unused-vars
  const plugin = (file, librarySettings, inputs, otherArguments) => {
    const lib = require('../methods/lib')();
    // eslint-disable-next-line no-unused-vars,no-param-reassign
    inputs = lib.loadDefaultValues(inputs, details);
    const response = {
      processFile: false,
      infoLog: '',
      handBrakeMode: false, // Set whether to use HandBrake or FFmpeg for transcoding
      FFmpegMode: true,
      reQueueAfter: true,
      // Leave as true. File will be re-qeued afterwards and pass through the plugin
      // filter again to make sure it meets conditions.
    };

    // Check that inputs.container has been configured, else dump out
    if (inputs.container === '') {
      response.infoLog += 'Plugin has not been configured, please configure required options. Skipping this plugin. \n';
      response.processFile = false;
      return response;
    }
    response.container = `.${inputs.container}`;

    // Check if file is a video. If it isn't then exit plugin.
    if (file.fileMedium !== 'video') {
      response.processFile = false;
      response.infoLog += 'File is not a video. \n';
      return response;
    }

    // Set up required variables.
    const nodeHardwareType = otherArguments['nodeHardwareType'];
    let encoder = "libx264";
    let isAAC = false;
    let isH264 = false;
    let isCorrectContainer = false;
    let videoIdx = 0;
    let extraArguments = '';
    
    // Check if using GPU/iGPU to encode
    if (nodeHardwareType == "nvenc") {
      encoder = "h264_nvenc"
    } else if (nodeHardwareType == "qsv") {
      encoder = "h264_qsv"
      extraArguments += "-global_quality 15 "; // Quality settings for QSV encoding
    } else if (nodeHardwareType == "vaapi") {
      encoder = "h264_vaapi"
    }
    
    // Check if force_conform option is checked.
    // If so then check streams and add any extra parameters required to make file conform with output format.
    if (inputs.force_conform === 'true') {
      if (inputs.container.toLowerCase() === 'mkv') {
        extraArguments += '-map -0:d ';
        for (let i = 0; i < file.ffProbeData.streams.length; i++) {
          try {
            if (
              file.ffProbeData.streams[i].codec_name
                .toLowerCase() === 'mov_text'
                          || file.ffProbeData.streams[i].codec_name
                            .toLowerCase() === 'eia_608'
                          || file.ffProbeData.streams[i].codec_name
                            .toLowerCase() === 'timed_id3'
            ) {
              extraArguments += `-map -0:${i} `;
            }
          } catch (err) {
          // Error
          }
        }
      }
      if (inputs.container.toLowerCase() === 'mp4') {
        for (let i = 0; i < file.ffProbeData.streams.length; i++) {
          try {
            if (
              file.ffProbeData.streams[i].codec_name
                .toLowerCase() === 'hdmv_pgs_subtitle'
                          || file.ffProbeData.streams[i].codec_name
                            .toLowerCase() === 'eia_608'
                          || file.ffProbeData.streams[i].codec_name
                            .toLowerCase() === 'subrip'
                          || file.ffProbeData.streams[i].codec_name
                            .toLowerCase() === 'timed_id3'
            ) {
              extraArguments += `-map -0:${i} `;
            }
          } catch (err) {
          // Error
          }
        }
      }
    }

    // Go through each stream in the file
    for (let i = 0; i < file.ffProbeData.streams.length; i++) {
      // Check if stream is video
      if (file.ffProbeData.streams[i].codec_type.toLowerCase() === 'video') {
        // Check if the video stream is mjpeg/png, and removes it.
        // These are embedded image streams which ffmpeg doesn't like to work with as a video stream
        if (file.ffProbeData.streams[i].codec_name.toLowerCase() === 'mjpeg'
                  || file.ffProbeData.streams[i].codec_name.toLowerCase() === 'png') {
          response.infoLog += 'File Contains mjpeg / png video streams, removing.';
          extraArguments += `-map -v:${videoIdx} `;
        }

        // If video is h264 8 bit
        if (file.ffProbeData.streams[i].codec_name.toLowerCase() === 'h264' && file.ffProbeData.streams[i].profile != "Main 10") {
          isH264 = true;
        }

        // If video is in correct container
        if (file.container == inputs.container) {
          isCorrectContainer = true;
        }

        // Increment videoIdx.
        videoIdx += 1;
      }

      // Check if stream is audio
      if (file.ffProbeData.streams[i].codec_type.toLowerCase() === 'audio') {

          // If audio is acc
          if (file.ffProbeData.streams[i].codec_name.toLowerCase() === 'aac') {
              isAAC = true;
          }
      }
    }

    // If audio is aac, encode audio
    if (!isAAC) {
      response.infoLog += '☒File has no aac track \n';
      response.preset = ', -map 0:v -map 0:a -map 0:s? -c:v copy -c:a aac -c:s copy';
      response.reQueueAfter = true;
      response.processFile = true;
      response.FFmpegMode = true;
      return response;
    }

    // if video is h264 8 bit, but container does NOT match desired container, do a remux
    if (isH264 && !isCorrectContainer) {
      response.processFile = true;
      response.infoLog += `File is already H264 but file is not in ${inputs.container}. Remuxing \n`;
      response.preset = `, -map 0 -c copy ${extraArguments}`;
      return response;
    }

    // If video is h264 8 bit, and container matches desired container, we don't need to do anything
    if (isH264) {
      response.processFile = false;
      response.infoLog += `File is already H264 and in ${inputs.container} \n`;
      return response;
    }

    // Codec will be checked so it can be transcoded correctly
    if (file.video_codec_name === 'h263') {
      response.preset = '-c:v h263_cuvid';
    } else if (file.video_codec_name === 'hevc') {
      response.preset = '';
    } else if (file.video_codec_name === 'av1') {
      response.preset = '';
    } else if (file.video_codec_name === 'vp9') {
      response.preset = '';
    } else if (file.video_codec_name === 'mjpeg') {
      response.preset = '-c:v mjpeg_cuvid';
    } else if (file.video_codec_name === 'mpeg1') {
      response.preset = '-c:v mpeg1_cuvid';
    } else if (file.video_codec_name === 'mpeg2') {
      response.preset = '-c:v mpeg2_cuvid';
    } else if (file.video_codec_name === 'vc1') {
      response.preset = '-c:v vc1_cuvid';
    } else if (file.video_codec_name === 'vp8') {
      response.preset = '-c:v vp8_cuvid';
    }

    response.preset += `,-map 0:v -map 0:a -map 0:s? `
    + `-c:v ${encoder} -crf 13 -vf format=yuv420p `
    + `-c:a copy -c:s copy ${extraArguments}`;
    response.processFile = true;
    response.infoLog += 'File is not h264. Transcoding. \n';
    return response;
  };

  module.exports.details = details;
  module.exports.plugin = plugin;
