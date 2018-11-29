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
  var quality = mapLinear(0, 100, 32, 2,
    options.quality || 70)

  var args = [
    '-y',
    '-f', 'image2pipe',
    '-r', '' + (+fps),
    // we use jpeg here because the most common version of ffmpeg (the one
    // that ships with homebrew) is broken and crashes when you feed it PNG data
    //  https://trac.ffmpeg.org/ticket/1272
    '-vcodec', 'mjpeg',
    '-i', '-'
  ]

  var outFile = options.output

  if ('format' in options) {
    args.push('-f', options.format)
  } else if (!outFile) {
    args.push('-f', 'matroska')
  }

  args.push(
    '-qscale', quality,
    '-q:v', quality)

  if (outFile) {
    args.push(outFile)
  } else {
    args.push('-')
  }

  var ffmpeg = spawn(ffmpegPath, args)

  function appendFrame (next) {
    // This is dumb, but sometimes electron's capture fails silently and returns
    // an empty buffer instead of an image.  When this happens we can retry and
    // usually it works the second time.
    function tryCapture () {
      try {
        win.capturePage(function (image) {
          var jpeg = image.toJPEG(100)
          if (jpeg.length === 0) {
            setTimeout(tryCapture, 10)
          } else {
            ffmpeg.stdin.write(jpeg, function (err) {
              next(err)
            })
          }
        })
      } catch (err) {
        next(err)
      }
    }
    tryCapture()
  }

  function endMovie () {
    ffmpeg.stdin.end()
  }

  var result = {
    frame: appendFrame,
    end: endMovie,
    log: ffmpeg.stderr
  }

  if (!outFile) {
    result.stream = ffmpeg.stdout
  }

  return result
}

function mapLinear (a1, a2, b1, b2, x) {
  return b1 + (x - a1) * (b2 - b1) / (a2 - a1)
}
