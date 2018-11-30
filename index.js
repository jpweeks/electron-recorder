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

    raw.stdout.on('data', function (data) {
      out.stdin.write(data, function (err) {
        if (err) throw err
      })
    })

    raw.stdout.on('end', function () {
      out.stdin.end()
    })

    out.stderr.on('data', function (data) {
      if (log) log(data.toString())
    })

    return {
      raw: raw,
      out: out
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

  function endVideo () {
    processors.raw.stdin.end()
  }

  api.frame = appendFrame
  api.end = endVideo
  if (!outFile) api.stream = processors.out.stdout

  return api
}
