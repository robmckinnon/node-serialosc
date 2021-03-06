var prime = require('prime');

module.exports = prime({
  _attributes: false,
  _oscServer: false,
  _oscClient: false,
  _ad: false,
  _emitter: false,

  constructor: function(options) {
    this._attributes = options;
    // init led state and level caches
    this._attributes.ledState = this._init2DArray(this._attributes.sizeX, this._attributes.sizeY, 0);
    this._attributes.ledLevel = this._init2DArray(this._attributes.sizeX, this._attributes.sizeY, 15);
  },

  // handles a message as if it were serialosc
  oscIn: function(msg) {
    var addr = msg.shift();
    this._emitter.emit('oscIn', msg);
    var x,y;
    // console.log('received', msg)
    switch(addr) {

      // handle /sys/port from an app/client
      // set the port we send to them on
      case '/sys/port':
        this._attributes.listenPort = msg[0];
        // echo back the port message with our new setting
        this.oscOut('/sys/port', this._attributes.listenPort);
        // restart socket / mdns advertisement
        this._emitter.emit('respawn');
        break;

      // send back information about this device
      // 1st and 2nd args can actually set a new port/host
      case '/sys/info':
        if (msg.length > 0) {
          if (msg.length == 1) {
            this._attributes.listenPort = msg[0];
          }
          if (msg.length == 2) {
            this._attributes.listenHost = msg[0];
            this._attributes.listenPort = msg[1];
          }
        }
        this.oscOut('/sys/id', this._attributes.serialoscId);
        this.oscOut('/sys/size', this._attributes.sizeX, this._attributes.sizeY);
        this.oscOut('/sys/host', this._attributes.listenHost);
        this.oscOut('/sys/port', this._attributes.listenPort);
        this.oscOut('/sys/prefix', this._attributes.prefix);
        this.oscOut('/sys/rotation', this._attributes.rotation);
        break;

      // set prefix and/or send back prefix
      case '/sys/prefix':
        if (msg.length > 0) {
          this._attributes.prefix = msg[0];
        }
        this.oscOut('/sys/prefix', this._attributes.prefix);
        break;

      // set rotation and/or send back rotation
      case '/sys/rotation':
        if (msg.length > 0) {
          this._attributes.rotation = parseInt(msg[0], 10);
        }
        this.oscOut('/sys/rotation', this._attributes.rotation);
        break;

      // set one led
      case this._attributes.prefix + '/grid/led/set':
        this._setLedState(msg[0], msg[1], msg[2]);
        break;

      // length of message determines how many leds we set
      // each additional argument is +8 leds
      // bitwise "and" on appropriate argument of msg (based on x) to check if bit is on
      // 2 ^ (x % 8) because x will go over 8 when there are multiple arguments
      case this._attributes.prefix + '/grid/led/row':
        for (x = msg[0]; x < ((msg.length - 2) * 8) + msg[0]; x++) {
          this._setLedState(x, msg[1], msg[2 + Math.floor((x - msg[0]) / 8)] & Math.pow(2, (x - msg[0]) % 8) ? 1 : 0);
        }
        break;

      // inverse of row logic
      case this._attributes.prefix + '/grid/led/col':
        for (y = msg[1]; y < ((msg.length - 2) * 8) + msg[1]; y++) {
          this._setLedState(msg[0], y, msg[2 + Math.floor((y - msg[1]) / 8)] & Math.pow(2, (y - msg[1]) % 8) ? 1 : 0);
        }
        break;

      // row logic on drugs
      case this._attributes.prefix + '/grid/led/map':
        for (x = msg[0]; x < 8 + msg[0]; x++) {
          for (y = msg[1]; y < 8 + msg[1]; y++) {
            this._setLedState(x, y, msg[2 + (y - msg[1])] & Math.pow(2, (x - msg[0])) ? 1 : 0);
          }
        }
        break;

      // set all leds, straightforward
      case this._attributes.prefix + '/grid/led/all':
        for (x = 0; x < this._attributes.sizeX; x++) {
          for (y = 0; y < this._attributes.sizeY; y++) {
            this._setLedState(x, y, msg[0]);
          }
        }
        break;

      // set one level
      case this._attributes.prefix + '/grid/led/level/set':
        this._setGridLedLevel(msg[0], msg[1], msg[2]);
        break;

      // set a row of levels
      case this._attributes.prefix + '/grid/led/level/row':
        for (x = msg[0]; x < msg.length + msg[0] - 2; x++) {
          this._setGridLedLevel(x, msg[1], msg[2 + x - msg[0]]);
        }
        break;

      // set a column of levels
      case this._attributes.prefix + '/grid/led/level/col':
        for (y = msg[1]; y < msg.length + msg[1] - 2; y++) {
          this._setGridLedLevel(msg[0], y, msg[2 + y - msg[1]]);
        }
        break;

      // set 64 levels
      case this._attributes.prefix + '/grid/led/level/map':
        for (x = msg[0]; x < 8 + msg[0]; x++) {
          for (y = msg[1]; y < 8 + msg[1]; y++) {
            this._setGridLedLevel(x, y, msg[2 + (((y - msg[1]) * 8) + (x - msg[0]))]);
          }
        }
        break;

      // set all the levels
      case this._attributes.prefix + '/grid/led/level/all':
        for (x = 0; x < this._attributes.sizeX; x++) {
          for (y = 0; y < this._attributes.sizeY; y++) {
            this._setGridLedLevel(x, y, msg[0]);
          }
        }
        break;

      case this._attributes.prefix + '/ring/set':
        this._setArcLedLevel(msg[0], msg[1], msg[2]);
        break;

      case this._attributes.prefix + '/ring/all':
        for (x = 0; x < 64; x++) {
          this._setArcLedLevel(msg[0], x, msg[1]);
        }
        break;

      case this._attributes.prefix + '/ring/map':
        for (x = 0; x < 64; x++) {
          this._setArcLedLevel(msg[0], x, msg[x+1]);
        }
        break;

      case this._attributes.prefix + '/ring/range':
        for (x = msg[1]; x < msg[2]; x++) {
          var x1 = x;
          while (x1 < 0) x1 += 64;
          x1 = x1 % 64;
          this._setArcLedLevel(msg[0], x1, msg[3]);
        }
        break;
    }
  },

  // send osc message to client application (ie /grid/key)
  oscOut: function() {
    // automatically prepend prefix if not /sys message
    if (!arguments[0].match(/^\/sys/)) {
      arguments[0] = this._attributes.prefix + arguments[0];
    }
// WTF?! where is "arguments ?"
   this._oscClient.send.apply(this._oscClient, arguments);
   this._emitter.emit('oscOut', msg);
  },

  // store led state as 2d array
  // emit stateChange event when state is actually changed
  // acts as a cache against messages that don't actually change the state
  // only used by grid, arc uses ledLevel exclusively
  _setLedState: function(x, y, s) {
    if (this._attributes.ledState.length != this._attributes.sizeY ||
        !this._attributes.ledState[0] ||
        (this._attributes.ledState[0] && this._attributes.ledState[0].length != this._attributes.sizeX)) {
      this._attributes.ledState = this._init2DArray(this._attributes.sizeY, this._attributes.sizeX, 0);
    }
    var oldX = x;
    x = this._translateX(x, y);
    y = this._translateY(oldX, y);
    if (this._attributes.ledState[y][x] != s) {
      this._attributes.ledState[y][x] = s;
      this._emitter.emit('ledStateChange', { x: x, y: y, s: s });
    }
  },

  // store led level state as 2d array
  // emit levelChange event when level is actually changed
  // acts as a cache against messages that don't actually change the state
  _setGridLedLevel: function(x, y, s) {
    if (this._attributes.ledLevel.length != this._attributes.sizeY ||
        !this._attributes.ledState[0] ||
        (this._attributes.ledLevel[0] && this._attributes.ledLevel[0].length != this._attributes.sizeX)) {
      this._attributes.ledLevel = this._init2DArray(this._attributes.sizeY, this._attributes.sizeX, 15);
    }
    x = this._translateX(x, y);
    y = this._translateY(x, y);
    if (this._attributes.ledLevel[y][x] != s) {
      this._attributes.ledLevel[y][x] = s;
      this._emitter.emit('ledLevelChange', { x: x, y: y, s: s });
    }
  },

  // store led level state as 2d array
  // emit levelChange event when level is actually changed
  // acts as a cache against messages that don't actually change the state
  _setArcLedLevel: function(n, x, l) {
    if (this._attributes.ledLevel.length != this._attributes.encoders ||
        !this._attributes.ledLevel[0] ||
        (this._attributes.ledLevel[0] && this._attributes.ledLevel[0].length != 64)) {
      this._attributes.ledLevel = this._init2DArray(this._attributes.encoders, 64, 0);
    }
    if (this._attributes.ledLevel[n][x] != l) {
      this._attributes.ledLevel[n][x] = l;
      this._emitter.emit('ledLevelChange', { n: n, x: x, l: l });
    }
  },

  _translateX: function(x, y) {
    var newX = x;
    if (this._attributes.rotation == 90) {
      newX = y;
    }
    else if (this._attributes.rotation == 180) {
      newX = this._attributes.sizeY - y - 1;
    }
    else if (this._attributes.rotation == 270) {
      newX = this._attributes.sizeY - y - 1;
    }
    return newX;
  },

  _translateY: function(x, y) {
    var newY = y;
    if (this._attributes.rotation == 90) {
      newY = this._attributes.sizeX - x - 1;
    }
    else if (this._attributes.rotation == 180) {
      newY = this._attributes.sizeX - x - 1;
    }
    else if (this._attributes.rotation == 270) {
      newY = x;
    }
    return newY;
  },

  // create a 2d array and initialize all values to val
  _init2DArray: function(sizeX, sizeY, val) {
    var arr = [];
    for (var x = 0; x < sizeX; x++) {
      arr[x] = [];
      for (var y = 0; y < sizeY; y++) {
        arr[x][y] = val;
      }
    }
    return arr;
  }
});