function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) {
        resolve(value);
    } else {
        Promise.resolve(value).then(_next, _throw);
    }
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
function _class_call_check(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
        throw new TypeError("Cannot call a class as a function");
    }
}
function _defineProperties(target, props) {
    for(var i = 0; i < props.length; i++){
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
    }
}
function _create_class(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
}
function _ts_generator(thisArg, body) {
    var f, y, t, g, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    };
    return g = {
        next: verb(0),
        "throw": verb(1),
        "return": verb(2)
    }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
        return this;
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(_)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
export var SpeechManager = /*#__PURE__*/ function() {
    "use strict";
    function SpeechManager(onTranscript, onRecognitionActive) {
        var _this = this;
        _class_call_check(this, SpeechManager);
        this.onTranscript = onTranscript;
        this.onRecognitionActive = onRecognitionActive;
        this.recognition = null;
        this.isRecognizing = false;
        this._manuallyStopped = false;
        this.finalTranscript = '';
        this.interimTranscript = '';
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'zh-CN';
            this.recognition.onstart = function() {
                _this.isRecognizing = true;
                console.log('语音识别已启动。');
                if (_this.onRecognitionActive) _this.onRecognitionActive(true);
            };
            this.recognition.onresult = function(event) {
                _this.interimTranscript = '';
                for(var i = event.resultIndex; i < event.results.length; ++i){
                    if (event.results[i].isFinal) {
                        if (_this.onTranscript) {
                            _this.onTranscript(event.results[i][0].transcript, '');
                        }
                        _this.finalTranscript = '';
                    } else {
                        _this.interimTranscript += event.results[i][0].transcript;
                        if (_this.onTranscript) {
                            _this.onTranscript(null, _this.interimTranscript);
                        }
                    }
                }
                if (_this.interimTranscript && !event.results[event.results.length - 1].isFinal) {
                    if (_this.onTranscript) {
                        _this.onTranscript(null, _this.interimTranscript);
                    }
                }
            };
            this.recognition.onerror = function(event) {
                console.error('语音识别错误:', event.error);
                var oldIsRecognizing = _this.isRecognizing;
                _this.isRecognizing = false;
                _this.finalTranscript = '';
                _this.interimTranscript = '';
                if (_this.onTranscript) _this.onTranscript('', '');
                if (oldIsRecognizing && _this.onRecognitionActive) _this.onRecognitionActive(false);
                if (event.error === 'aborted' || event.error === 'no-speech') {
                    console.log('因无语音或中止，准备重启识别。');
                }
            };
            this.recognition.onend = function() {
                var oldIsRecognizing = _this.isRecognizing;
                _this.isRecognizing = false;
                console.log('语音识别已结束。');
                _this.finalTranscript = '';
                _this.interimTranscript = '';
                if (_this.onTranscript) _this.onTranscript('', '');
                if (oldIsRecognizing && _this.onRecognitionActive) _this.onRecognitionActive(false);
                // 如果是手动停止，不自动重启
                if (_this._manuallyStopped) {
                    _this._manuallyStopped = false;
                    return;
                }
                if (_this.recognition.continuous) {
                    console.log('连续模式：重新启动语音识别。');
                    _this.startRecognition();
                }
            };
        } else {
            console.warn('此浏览器不支持Web语音API。');
        }
    }
    _create_class(SpeechManager, [
        {
            key: "startRecognition",
            value: function startRecognition() {
                var _this = this;
                this._manuallyStopped = false;
                if (this.recognition && !this.isRecognizing) {
                    try {
                        this.finalTranscript = '';
                        this.interimTranscript = '';
                        this.recognition.start();
                    } catch (e) {
                        console.error("启动语音识别时出错:", e);
                        if (e.name === 'InvalidStateError' && this.isRecognizing) {
                        } else {
                            setTimeout(function() {
                                return _this.startRecognition();
                            }, 500);
                        }
                    }
                }
            }
        },        {
            key: "stopRecognition",
            value: function stopRecognition() {
                if (this.recognition && this.isRecognizing) {
                    this._manuallyStopped = true;
                    this.recognition.stop();
                }
            }
        },
        {
            key: "updateSpeechRecognitionState",
            value: function updateSpeechRecognitionState() {
                const speechEnabled = localStorage.getItem('speechRecognitionEnabled') !== 'false';
                
                if (speechEnabled && !this.isRecognizing) {
                    this.requestPermissionAndStart();
                } else if (!speechEnabled && this.isRecognizing) {
                    this.stopRecognition();
                }
                
                return speechEnabled;
            }
        },
        {
            key: "requestPermissionAndStart",
            value: 
            function requestPermissionAndStart() {
                var _this = this;
                return _async_to_generator(function() {
                    var err;
                    return _ts_generator(this, function(_state) {
                        switch(_state.label){
                            case 0:
                                if (!_this.recognition) {
                                    console.log("语音识别不受支持。");
                                    return [
                                        2
                                    ];
                                }
                                _state.label = 1;
                            case 1:
                                _state.trys.push([
                                    1,
                                    3,
                                    ,
                                    4
                                ]);
                                return [
                                    4,
                                    navigator.mediaDevices.getUserMedia({
                                        audio: true
                                    })
                                ];
                            case 2:
                                _state.sent();
                                console.log("麦克风权限已授予。");
                                _this.startRecognition();
                                return [
                                    3,
                                    4
                                ];
                            case 3:
                                err = _state.sent();
                                console.error("麦克风权限被拒绝或出错:", err);
                                if (_this.onTranscript) {
                                    _this.onTranscript("麦克风访问被拒绝。请在浏览器设置中允许麦克风访问。", "");
                                }
                                return [
                                    3,
                                    4
                                ];
                            case 4:
                                return [
                                    2
                                ];
                        }
                    });
                })();
            }
        }
    ]);
    return SpeechManager;
}();