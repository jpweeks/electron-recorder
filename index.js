var spawn = require('child_process').spawn
var ffmpegStatic = require('ffmpeg-static')

module.exports = createMovieRecorderStream

function createMovieRecorderStream (win, options_) {
  var options = options_ || {}

  if (!win) {
    throw new Error('electron-recorder: you must specify a BrowserWindow')
  }

  var ffmpegPath = options.ffmpeg || ffmpegStatic.path
  var fps = options.fps || 60
  var crf = options.crf || 18
  var outFile = options.output || null
  var log = options.log

  var api = {}
  var processors = {}
  var didSetupProcessors = false
  function setupProcessors (image) {
    if (didSetupProcessors) return processors
    processors = createProcessors(image)
    didSetupProcessors = true
  }

  // For some reason need the second processor to get a file readable by QuickTime
  function createProcessors (image) {
    var size = image.getSize()
    var isWriting = false

    // Raw bitmap image buffer stream encoded to lossless h264
    var raw = spawn(ffmpegPath, [
      '-y',
      '-an',

      '-r', '' + (+fps),
      '-f', 'rawvideo',
      '-video_size', size.width + 'x' + size.height,
      '-pix_fmt', 'bgra',
      '-i', '-',

      '-f', 'h264',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '0',

      '-'
    ])

    // Compressed h264 encoder
    var out = spawn(ffmpegPath, [
      '-y',
      '-an',

      '-i', '-',

      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-crf', crf,

      outFile || '-'
    ])

    // Pipe raw stream to compressor stream
    raw.stdout.on('data', function (data) {
      isWriting = true
      out.stdin.write(data, function (err) {
        isWriting = false
        if (err) throw err
      })
    })

    // Send compressor stream info to log
    out.stderr.on('data', function (data) {
      if (log) log(data.toString())
    })

    function awaitWritingComplete (onComplete) {
      (function willAwait () {
        if (isWriting) return setTimeout(willAwait, 100)
        setTimeout(onComplete, 100)
      })()
    }

    function end (done) {
      processors.raw.stdin.end()
      awaitWritingComplete(function () {
        out.stdin.end()
        done()
      })
    }

    return {
      raw: raw,
      out: out,
      end: end
    }
  }

  function appendFrame (next) {
    // This is dumb, but sometimes electron's capture fails silently and returns
    // an empty buffer instead of an image.  When this happens we can retry and
    // usually it works the second time.
    function tryCapture () {
      try {
        win.capturePage(function (image) {
          var buf = image.getBitmap()
          if (buf.length === 0) return setTimeout(tryCapture, 10)

          setupProcessors(image)
          processors.raw.stdin.write(buf, function (err) {
            next(err)
          })
        })
      } catch (err) {
        next(err)
      }
    }
    tryCapture()
  }

  function endVideo (done) {
    processors.end(done)
  }

  api.frame = appendFrame
  api.end = endVideo
  if (!outFile) api.stream = processors.out.stdout

  return api
}
