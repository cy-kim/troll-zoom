let rainCanvas, rainCtx;
let filterMode = 0;

let myVolume = 0;

let rainInit = [];
let rainParticles = [];
let volumeThresh = 20;
let rainMax = 500;

let audioStream = null;
//audio stuff

let simplepeers = [];
var socket;

// wait for window to load
window.addEventListener("load", function () {
  let rainCanvas = document.getElementById("rainCanvas");
  let rainCtx = rainCanvas.getContext("2d");

  rainCanvas.width = window.innerWidth;
  rainCanvas.height = window.innerHeight;

  rainCtx.strokeStyle = "rgba(255,255,255,0.4)";
  rainCtx.lineWidth = 0.1;
  rainCtx.lineCap = "butt";

  for (let i = 0; i < rainMax; i++) {
    rainInit.push({
      x: Math.random() * rainCanvas.width,
      y: Math.random() * rainCanvas.height,
      l: 3,
      xs: -4 + Math.random() * 4 + 2,
      ys: Math.random() * 15 + 10,
    });
  }

  for (let i = 0; i < rainMax; i++) {
    rainParticles[i] = rainInit[i];
  }

  let bgCanvas = document.getElementById("bgCanvas");
  let bgCtx = bgCanvas.getContext("2d");
  let bgImg = document.getElementById("bgImg");
  let bgImg2 = document.getElementById("bgImg2");

  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;

  bgCtx.drawImage(bgImg, 0, 0, bgCanvas.width, bgCanvas.height);

  // simplified canvas maniuplation func from http://html5doctor.com/video-canvas-magic/
  // modified to have mulitple filters

  function draw() {
    setTimeout(function () {
      rainCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      //myVolume to be included in sum

      let sumOfVolume = myVolume;
      draw();

      for (let peer of simplepeers) {
        sumOfVolume += peer.mappedVolume;
      }
      if (sumOfVolume >= volumeThresh) {
        bgCtx.drawImage(bgImg2, 0, 0, bgCanvas.width, bgCanvas.height);

        for (let i = 0; i < rainParticles.length; i++) {
          let rP = rainParticles[i];
          rainCtx.beginPath();
          rainCtx.moveTo(rP.x, rP.y);
          rainCtx.lineTo(rP.x + rP.l * rP.xs, rP.y + rP.l * rP.ys);
          rainCtx.stroke();
          rainCtx.lineWidth = 5;
        }
      } else {
        bgCtx.drawImage(bgImg, 0, 0, bgCanvas.width, bgCanvas.height);
      }

      move();
    }, 0);
  }

  function move() {
    for (let i = 0; i < rainParticles.length; i++) {
      let p = rainParticles[i];
      //p.x += p.xs;
      p.y += p.ys;

      if (p.x > rainCanvas.width || p.y > rainCanvas.height) {
        p.x = Math.random() * rainCanvas.width;
        p.y = -50;
      }
    }
  }

  // Constraints - what do we want?
  let constraints = {
    audio: true,
    video: false,
  };

  // Prompt the user for permission, get the stream
  navigator.mediaDevices
    .getUserMedia(constraints)
    .then(function (stream) {
      // separate audio and video so we can add audio to canvas prior to streaming to peers
      audioStream = new MediaStream(stream.getAudioTracks());

      // Wait for the audio and video streams to load enough to play
      myAudio.srcObject = audioStream;
      myAudio.muted = true;

      myAudio.onloadedmetadata = function (e) {
        myAudio.play();
        beginDetect();
      };

      // Now setup socket
      setupSocket();
    })
    .catch(function (err) {
      /* Handle the error */
      alert(err);
    });

  draw();
});

var audioContext;
var mediaStreamSource = null;
var meter = null;

function beginDetect() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      mediaStreamSource = audioContext.createMediaStreamSource(stream);
      meter = createAudioMeter(audioContext);
      mediaStreamSource.connect(meter);
    });
  }
}

function createAudioMeter(audioContext, clipLevel, averaging, clipLag) {
  const processor = audioContext.createScriptProcessor(512);
  processor.onaudioprocess = volumeAudioProcess;
  processor.clipping = false;
  processor.lastClip = 0;
  processor.volume = 0;
  processor.clipLevel = clipLevel || 0.98;
  processor.averaging = averaging || 0.95;
  processor.clipLag = clipLag || 750;

  // this will have no effect, since we don't copy the input to the output,
  // but works around a current Chrome bug.
  processor.connect(audioContext.destination);

  processor.checkClipping = function () {
    if (!this.clipping) {
      return false;
    }
    if (this.lastClip + this.clipLag < window.performance.now()) {
      this.clipping = false;
    }
    return this.clipping;
  };

  processor.shutdown = function () {
    this.disconnect();
    this.onaudioprocess = null;
  };

  return processor;
}

function volumeAudioProcess(event) {
  const buf = event.inputBuffer.getChannelData(0);
  const bufLength = buf.length;
  let sum = 0;
  let x;

  // Do a root-mean-square on the samples: sum up the squares...
  for (var i = 0; i < bufLength; i++) {
    x = buf[i];
    if (Math.abs(x) >= this.clipLevel) {
      this.clipping = true;
      this.lastClip = window.performance.now();
    }
    sum += x * x;
  }

  // ... then take the square root of the sum.
  const rms = Math.sqrt(sum / bufLength);

  // Now smooth this out with the averaging factor applied
  // to the previous sample - take the max here because we
  // want "fast attack, slow release."
  this.volume = Math.max(rms, this.volume * this.averaging);
  this.mappedVolume = Math.floor(mapRange(this.volume, 0, 1, 0, 50));
  document.getElementById("myAudioValue").innerHTML = this.mappedVolume;
  myVolume = this.mappedVolume;
  //console.log(this.volume)
}

function mapRange(value, a, b, c, d) {
  // first map value from (a..b) to (0..1)
  value = (value - a) / (b - a);
  // then map it from (0..1) to (c..d) and return it
  return c + value * (d - c);
}

function setupSocket() {
  socket = io.connect();

  socket.on("connect", function () {
    console.log("**Socket Connected**");
    console.log("My socket id: ", socket.id);

    // Tell the server we want a list of the other users
    socket.emit("list");
  });

  socket.on("disconnect", function (data) {
    console.log("Socket disconnected");
  });

  socket.on("peer_disconnect", function (data) {
    console.log("simplepeer has disconnected " + data);
    for (let i = 0; i < simplepeers.length; i++) {
      if (simplepeers[i].socket_id == data) {
        console.log("Removing simplepeer: " + i);
        simplepeers.splice(i, 1);

        document.getElementById(data).remove();
      }
    }
  });

  // Receive listresults from server
  socket.on("listresults", function (data) {
    for (let i = 0; i < data.length; i++) {
      // Make sure it's not us
      if (data[i] != socket.id) {
        // create a new simplepeer and we'll be the "initiator"
        let simplepeer = new SimplePeerWrapper(
          true,
          data[i],
          socket,
          audioStream
        );

        // Push into our array
        simplepeers.push(simplepeer);

        //console.log(simplepeers);
      }
    }
  });

  socket.on("signal", function (to, from, data) {
    console.log("Got a signal from the server: ", to, from, data);

    // to should be us
    if (to != socket.id) {
      console.log("Socket IDs don't match");
    }

    // Look for the right simplepeer in our array
    let found = false;
    for (let i = 0; i < simplepeers.length; i++) {
      if (simplepeers[i].socket_id == from) {
        console.log("Found right object");
        // Give that simplepeer the signal
        simplepeers[i].inputsignal(data);
        found = true;
        break;
      }
    }

    if (!found) {
      console.log("Never found right simplepeer object");
      // Let's create it then, we won't be the "initiator"
      let simplepeer = new SimplePeerWrapper(false, from, socket, audioStream);

      // Push into our array
      simplepeers.push(simplepeer);

      // Tell the new simplepeer that signal
      simplepeer.inputsignal(data);
    }
  });
}

const playStream = (stream, volume) => {
  let audio = document.querySelector("audio");

  audio.srcObject = stream;
  audio.volume = 0.9;
  audio.muted = false;

  audio.onloadedmetadata = function (e) {
    audio.play();
  };
};

// A wrapper for simplepeer as we need a bit more than it provides
class SimplePeerWrapper {
  constructor(initiator, socket_id, socket, stream) {
    this.simplepeer = new SimplePeer({
      initiator: initiator,
      trickle: false,
    });

    // Their socket id, our unique id for them
    this.socket_id = socket_id;

    // Socket.io Socket
    this.socket = socket;

    // Our video stream - need getters and setters for this --local stream
    this.stream = stream;

    // Initialize mediaStream to null
    this.peerStream = null;

    this.volume = 0;
    this.mappedVolume = 0;

    this.newVolume = null;

    // simplepeer generates signals which need to be sent across socket
    this.simplepeer.on("signal", (data) => {
      this.socket.emit("signal", this.socket_id, this.socket.id, data);
    });

    // When we have a connection, send our stream
    this.simplepeer.on("connect", () => {
      console.log("CONNECT");
      //console.log(this.simplepeer);

      // Let's give them our stream
      this.simplepeer.addStream(stream);

      console.log("Send our stream");
    });

    // Stream coming in to us
    this.simplepeer.on("stream", (stream) => {
      //console.log('Incoming Stream');
      console.log("Incoming stream", stream);
      console.log(stream.getAudioTracks());

      this.peerStream = stream;

      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      playStream(this.peerStream, this.volume);

      let newVolume = document.createElement("p");
      newVolume.id = this.socket_id;
      newVolume.zIndex = 1000;
      document.body.appendChild(newVolume);

      mediaStreamSource = audioContext.createMediaStreamSource(this.peerStream);
      meter = this.createAudioMeter(audioContext);
      mediaStreamSource.connect(meter);
    });
  }

  //https://codepen.io/huooo/pen/xJNPOL
  createAudioMeter(audioContext, clipLevel, averaging, clipLag) {
    const processor = audioContext.createScriptProcessor(256);
    processor.onaudioprocess = (event) => {
      const buf = event.inputBuffer.getChannelData(0);
      const bufLength = buf.length;
      let sum = 0;
      let x;

      // Do a root-mean-square on the samples: sum up the squares...
      for (var i = 0; i < bufLength; i++) {
        x = buf[i];
        if (Math.abs(x) >= processor.clipLevel) {
          processor.clipping = true;
          processor.lastClip = window.performance.now();
        }
        sum += x * x;
      }

      // ... then take the square root of the sum.
      const rms = Math.sqrt(sum / bufLength);

      // Now smooth this out with the averaging factor applied
      // to the previous sample - take the max here because we
      // want "fast attack, slow release."
      this.volume = Math.max(rms, this.volume * processor.averaging);
      this.mappedVolume = Math.floor(mapRange(this.volume, 0, 1, 0, 50));

      document.getElementById(this.socket_id).innerHTML = this.mappedVolume;
    };

    processor.clipping = false;
    processor.lastClip = 0;
    processor.volume = 0;
    processor.clipLevel = clipLevel || 0.98;
    processor.averaging = averaging || 0.95;
    processor.clipLag = clipLag || 750;

    processor.connect(audioContext.destination);

    processor.checkClipping = function () {
      if (!this.clipping) {
        return false;
      }
      if (this.lastClip + this.clipLag < window.performance.now()) {
        this.clipping = false;
      }
      return this.clipping;
    };

    processor.shutdown = function () {
      this.disconnect();
      this.onaudioprocess = null;
    };

    return processor;
  }

  inputsignal(sig) {
    this.simplepeer.signal(sig);
  }
}
