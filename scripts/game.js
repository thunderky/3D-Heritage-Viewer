// game.js - 主游戏类，负责3D场景渲染、手势追踪、模型交互等核心功能
import * as THREE from 'three';
import { GLTFLoader } from 'three/loaders/GLTFLoader.js';
import { HandLandmarker, FilesetResolver } from 'https://esm.sh/@mediapipe/tasks-vision@0.10.14';
import { AudioManager } from './audioManager.js';
import { SpeechManager } from './SpeechManager.js';
import { ModelSelector } from './modelSelector.js';
import { ModelLoadingBubble } from './modelLoadingBubble.js';
import { DescriptionManager } from './descriptionManager.js';
import { getModelConfig } from './modelConfig.js';

// ==================== 配置常量 ====================
const CONFIG = {
    hand: {
        smoothingFactor: 0.4,
        pinchThreshold: 45,
        fingertipRadius: 8,
        wristRadius: 12,
        circleSegments: 16,
        defaultOpacity: 0.3,
        grabOpacity: 1.0,
        fingertipIndices: [0, 4, 8, 12, 16, 20]
    },
    interaction: {
        rotateSensitivityKey: 'rotateSensitivity',
        scaleSensitivityKey: 'scaleSensitivity',
        mouseDragSensitivityKey: 'mouseDragSensitivity',
        mouseWheelSensitivityKey: 'mouseWheelSensitivity',
        defaultRotateSensitivity: 0.02,
        defaultScaleSensitivity: 1.5,
        defaultMouseDragSensitivity: 1.0,
        defaultMouseWheelSensitivity: 10.0,
        animationScrollThreshold: 40,
        pulseSpeed: 8,
        pulseAmplitude: 0.5,
        pulseBaseScale: 1.0,
        scaleMinDistance: 150,  // 双手最小距离阈值（像素），小于此距离不认为是缩放
        scaleDistanceChangeThreshold: 20  // 距离变化阈值（像素），超过此值才触发缩放
    },
    model: {
        defaultScale: 2000,
        defaultMaxScale: 5000,
        defaultMinScale: 10,
        positionYFactor: -0.45,
        positionZ: -1000,
        minZ: -200,
        maxZ: 50
    },
    camera: {
        nearPlane: 1,
        farPlane: 2000
    },
    light: {
        ambientIntensity: 1.5,
        directionalIntensity: 1.8
    }
};

// 交互模式及其UI配置
const INTERACTION_MODES = {
    auto: {
        base: '#d4af37',
        text: '#000000',
        hand: new THREE.Color('#d4af37'),
        instruction: '自动模式：单手五指=拖拽，单手二指=旋转，双手二指=缩放'
    },
    drag: {
        base: '#c9a030',
        text: '#000000',
        hand: new THREE.Color('#c9a030'),
        instruction: '捏合手指来抓取并移动模型'
    },
    rotate: {
        base: '#b8960f',
        text: '#ffffff',
        hand: new THREE.Color('#b8960f'),
        instruction: '捏合手指并左右移动手来旋转'
    },
    scale: {
        base: '#e6c34a',
        text: '#000000',
        hand: new THREE.Color('#e6c34a'),
        instruction: '使用双手，两手捏合并调整手之间的距离来缩放'
    },
    fixed: {
        base: '#555555',
        text: '#cccccc',
        hand: new THREE.Color('#555555'),
        instruction: '固定模式：手势识别已禁用'
    }
};

// 动画名称到中文的映射
const ANIMATION_TRANSLATIONS = {
    "idle": "待机",
    "walk": "行走",
    "run": "跑步",
    "jump": "跳跃",
    "attack": "攻击",
    "dance": "舞蹈",
    "animation 1": "动画 1",
    "animation 2": "动画 2",
    "animation 3": "动画 3",
    "animation 4": "动画 4",
    "animation 5": "动画 5"
};

// 定义手部骨骼连接，用于可视化
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],        // 拇指
    [0, 5], [5, 6], [6, 7], [7, 8],        // 食指
    [0, 9], [9, 10], [10, 11], [11, 12],   // 中指
    [0, 13], [13, 14], [14, 15], [15, 16], // 无名指
    [0, 17], [17, 18], [18, 19], [19, 20], // 小指
    [5, 9], [9, 13], [13, 17]              // 手掌
];

// ==================== 工具函数 ====================
class CoordinateTransformer {
    /**
     * 将MediaPipe地标坐标转换为屏幕坐标
     */
    static landmarkToScreen(landmark, videoParams, canvasWidth, canvasHeight) {
        const originalX = landmark.x * videoParams.videoNaturalWidth;
        const originalY = landmark.y * videoParams.videoNaturalHeight;
        const normX = (originalX - videoParams.offsetX) / videoParams.visibleWidth;
        const normY = (originalY - videoParams.offsetY) / videoParams.visibleHeight;
        
        return {
            x: (1 - normX) * canvasWidth - canvasWidth / 2,
            y: (1 - normY) * canvasHeight - canvasHeight / 2
        };
    }

    /**
     * 检查地标是否在屏幕内
     */
    static isLandmarkOnScreen(landmark, videoParams) {
        const originalX = landmark.x * videoParams.videoNaturalWidth;
        const originalY = landmark.y * videoParams.videoNaturalHeight;
        const normX = (originalX - videoParams.offsetX) / videoParams.visibleWidth;
        const normY = (originalY - videoParams.offsetY) / videoParams.visibleHeight;
        
        return normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1;
    }
}

class GestureDetector {
    /**
     * 检测捏合手势
     */
    static detectPinch(landmarks, videoParams, canvasWidth, canvasHeight) {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        
        if (!thumbTip || !indexTip) return null;

        const thumbScreen = CoordinateTransformer.landmarkToScreen(thumbTip, videoParams, canvasWidth, canvasHeight);
        const indexScreen = CoordinateTransformer.landmarkToScreen(indexTip, videoParams, canvasWidth, canvasHeight);
        
        const dx = thumbScreen.x - indexScreen.x;
        const dy = thumbScreen.y - indexScreen.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < CONFIG.hand.pinchThreshold) {
            return {
                isPinching: true,
                pinchPoint: {
                    x: (thumbScreen.x + indexScreen.x) / 2,
                    y: (thumbScreen.y + indexScreen.y) / 2
                }
            };
        }
        
        return { isPinching: false, pinchPoint: null };
    }

    /**
     * 检测握拳手势
     */
    static detectFist(landmarks) {
        const isTipNearMCP = (tipIdx, mcpIdx, threshold = 0.08) => {
            const tip = landmarks[tipIdx];
            const mcp = landmarks[mcpIdx];
            if (!tip || !mcp) return false;
            
            const dx = tip.x - mcp.x;
            const dy = tip.y - mcp.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            return distance < threshold;
        };

        let curledFingers = 0;
        if (isTipNearMCP(8, 5)) curledFingers++;   // 食指
        if (isTipNearMCP(12, 9)) curledFingers++;  // 中指
        if (isTipNearMCP(16, 13)) curledFingers++; // 无名指
        if (isTipNearMCP(20, 17)) curledFingers++; // 小指
        
        return curledFingers >= 3;
    }
}

// ==================== 主Game类 ====================
export class Game {
    constructor(renderDiv, initialModelPath = 'assets/teacup.gltf') {
        this.renderDiv = renderDiv;
        this.initialModelPath = initialModelPath;
        this._initProperties();
        this._init().catch(error => {
            console.error("初始化失败:", error);
            this._showError("初始化失败，请查看控制台");
        });
    }

    // ========== 初始化 ==========
    _initProperties() {
        // Three.js 核心对象
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // 视频与手势追踪
        this.videoElement = null;
        this.handLandmarker = null;
        this.lastVideoTime = -1;
        this.hands = [];
        this.lastLandmarkPositions = [[], []]; // 用于平滑处理

        // 材质
        this.handLineMaterial = null;
        this.fingertipMaterialHand1 = null;
        this.fingertipMaterialHand2 = null;

        // 模型与动画
        this.pandaModel = null;
        this.animationMixer = null;
        this.animationClips = [];
        this.animationActions = {};
        this.currentAction = null;

        // 交互状态
        this.gameState = 'loading';
        this.interactionMode = 'auto'; // 默认使用自动模式
        this.autoModeEnabled = true; // 自动手势识别模式
        this.grabbingHandIndex = -1;
        this.pickedUpModel = null;
        this.modelDragOffset = new THREE.Vector3();
        this.modelGrabStartDepth = 0;

        // 旋转模式
        this.rotateLastHandX = null;
        this.rotateLastHandY = null;
        this.rotateSensitivity = this._loadSensitivity('rotateSensitivity', CONFIG.interaction.defaultRotateSensitivity);

        // 缩放模式
        this.scaleInitialPinchDistance = null;
        this.scaleInitialModelScale = null;
        this.scaleSensitivity = this._loadSensitivity('scaleSensitivity', CONFIG.interaction.defaultScaleSensitivity);
        this.mouseDragSensitivity = this._loadSensitivity('mouseDragSensitivity', CONFIG.interaction.defaultMouseDragSensitivity);
        this.mouseWheelSensitivity = this._loadSensitivity('mouseWheelSensitivity', CONFIG.interaction.defaultMouseWheelSensitivity);

        // 鼠标交互状态
        this.mouseIsDragging = false;
        this.mouseIsRotating = false;
        this.mouseLastX = 0;
        this.mouseLastY = 0;
        this.mouseGrabScreenX = 0;
        this.mouseGrabScreenY = 0;
        this.mouseGrabModelPos = new THREE.Vector3();
        this.mouseGrabStartDepth = 0;

        // 动画控制
        this.animationControlHandIndex = -1;
        this.animationControlInitialPinchY = null;

        // 管理器
        this.audioManager = new AudioManager();
        this.speechManager = null;
        this.modelSelector = null;
        this.modelLoadingBubble = null;
        this.descriptionManager = null;

        // UI 元素
        this.speechBubble = null;
        this.speechBubbleTimeout = null;
        this.isSpeechActive = false;
        this.gameOverContainer = null;
        this.gameOverText = null;
        this.restartHintText = null;
        this.animationButtonsContainer = null;
        this.interactionModeContainer = null;
        this.interactionModeButtons = {};
        this.instructionTextElement = null;
        this.lastSpeechAIText = '';
        this.lastSpeechAITimestamp = 0;
    }

    _loadSensitivity(key, defaultValue) {
        const saved = localStorage.getItem(key);
        return saved ? parseFloat(saved) : defaultValue;
    }

    async _init() {
        this._setupDOM();
        this._setupThree();
        this._setupSpeechRecognition();
        this._setupMouseInteraction();
        
        await this._loadAssets();
        await this._setupHandTracking();
        await this.videoElement.play();
        
        this.audioManager.resumeContext();
        
        const speechEnabled = localStorage.getItem('speechRecognitionEnabled') !== 'false';
        if (speechEnabled) {
            this.speechManager.requestPermissionAndStart();
            this._showSpeechMessage("语音识别已启用", 2000);
        } else {
            this._showSpeechMessage("语音识别已禁用", 2000);
        }
        
        this.clock.start();
        window.addEventListener('resize', this._onResize.bind(this));
        this.gameState = 'tracking';
        this._animate();

        // 初始化其他模块
        this.modelLoadingBubble = new ModelLoadingBubble(this.renderDiv);
        this.modelSelector = new ModelSelector(this);
        this.descriptionManager = new DescriptionManager(this);

        this._setupStorageListener();
    }

    _setupStorageListener() {
        // 监听localStorage中的灵敏度设置变化
        window.addEventListener('storage', (e) => {
            if (e.key === 'scaleSensitivity') {
                this.scaleSensitivity = parseFloat(e.newValue);
                this.modelLoadingBubble?.showMessage("缩放灵敏度已更新", 2000);
            } else if (e.key === 'rotateSensitivity') {
                this.rotateSensitivity = parseFloat(e.newValue);
                this.modelLoadingBubble?.showMessage("旋转灵敏度已更新", 2000);
            } else if (e.key === 'mouseDragSensitivity') {
                this.mouseDragSensitivity = parseFloat(e.newValue);
                this.modelLoadingBubble?.showMessage("鼠标拖拽灵敏度已更新", 2000);
            } else if (e.key === 'mouseWheelSensitivity') {
                this.mouseWheelSensitivity = parseFloat(e.newValue);
                this.modelLoadingBubble?.showMessage("滚轮缩放灵敏度已更新", 2000);
            }
        });
    }

    async loadNewModel(modelPath) {
        try {
            this.modelLoadingBubble?.showMessage("正在加载模型...", 0);

            if (this.pandaModel) {
                this.scene.remove(this.pandaModel);
                this.pandaModel = null;
            }

            this.animationMixer = null;
            this.animationClips = [];
            this.animationActions = {};
            this.currentAction = null;

            const buttonContainer = document.getElementById('animation-buttons');
            if (buttonContainer) {
                buttonContainer.innerHTML = '';
            }

            const gltfLoader = new GLTFLoader();
            await new Promise((resolve, reject) => {
                gltfLoader.load(
                    modelPath,
                    (gltf) => {
                        this.pandaModel = gltf.scene;
                        this.animationMixer = new THREE.AnimationMixer(this.pandaModel);
                        this.animationClips = gltf.animations;

                        const config = getModelConfig(modelPath, this.renderDiv.clientHeight);

                        this.pandaModel.scale.set(config.scale, config.scale, config.scale);
                        this.pandaModel.userData.maxScale = config.maxScale;
                        this.pandaModel.userData.minScale = config.minScale;

                        this.pandaModel.position.set(0, 0, 0);
                        
                        // 对需要中心化的模型进行偏移补偿
                        if (config.centerOffset) {
                            const tempBox = new THREE.Box3().setFromObject(this.pandaModel);
                            const tempCenter = new THREE.Vector3();
                            tempBox.getCenter(tempCenter);
                            this.pandaModel.position.x = 0 - tempCenter.x;
                            this.pandaModel.position.y = config.posY - tempCenter.y;
                            this.pandaModel.position.z = config.posZ - tempCenter.z;
                        } else {
                            this.pandaModel.position.set(0, config.posY, config.posZ);
                        }

                        this.scene.add(this.pandaModel);

                        if (this.animationClips?.length) {
                            this._setupModelAnimations();
                        }

                        // 触发模型变更事件，通知其他模块
                        window.dispatchEvent(new CustomEvent('modelChanged', {
                            detail: { modelPath: modelPath }
                        }));

                        resolve();
                    },
                    undefined,
                    reject
                );
            });

            this.modelLoadingBubble?.showMessage("模型加载成功!", 2000);
        } catch (error) {
            console.error("加载模型失败:", error);
            this.modelLoadingBubble?.showMessage("加载模型失败", 3000);
        }
    }

    // ========== DOM设置 ==========
    _setupDOM() {
        this._setupContainer();
        this._setupVideo();
        this._setupStatusContainer();
        this._setupSpeechBubble();
        this._setupAnimationButtons();
        this._setupInteractionModeButtons();
        this._setupDragAndDrop();
    }

    _setupContainer() {
        this.renderDiv.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #111;
        `;
    }

    _setupVideo() {
        this.videoElement = document.createElement('video');
        this.videoElement.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: 100%;
            object-fit: contain;
            transform: translate(-50%, -50%) scaleX(-1);
            z-index: 0;
        `;
        this.videoElement.autoplay = true;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        this.renderDiv.appendChild(this.videoElement);
    }

    _setupStatusContainer() {
        this.gameOverContainer = document.createElement('div');
        this.gameOverContainer.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10;
            display: none;
            pointer-events: none;
            text-align: center;
            color: white;
            font-family: "Arial", "Helvetica Neue", Helvetica, sans-serif;
        `;

        this.gameOverText = document.createElement('div');
        this.gameOverText.style.cssText = `
            font-size: clamp(36px, 10vw, 72px);
            font-weight: bold;
            margin-bottom: 10px;
        `;
        
        this.restartHintText = document.createElement('div');
        this.restartHintText.style.cssText = `
            font-size: clamp(16px, 3vw, 24px);
            font-weight: normal;
            opacity: 0.8;
        `;
        this.restartHintText.innerText = '(点击重启追踪)';

        this.gameOverContainer.appendChild(this.gameOverText);
        this.gameOverContainer.appendChild(this.restartHintText);
        this.renderDiv.appendChild(this.gameOverContainer);
    }

    _setupSpeechBubble() {
        this.speechBubble = document.createElement('div');
        this.speechBubble.id = 'speech-bubble';
        this.speechBubble.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            padding: 15px 25px;
            background-color: rgba(255, 255, 255, 0.9);
            border: 2px solid black;
            border-radius: 4px;
            box-shadow: 4px 4px 0px rgba(0,0,0,1);
            color: #333;
            font-family: "Arial", "Helvetica Neue", Helvetica, sans-serif;
            font-size: clamp(16px, 3vw, 22px);
            max-width: 80%;
            text-align: center;
            z-index: 25;
            opacity: 0;
            transition: opacity 0.5s ease-in-out, transform 0.3s ease-in-out, 
                        box-shadow 0.3s ease-in-out, border 0.3s ease-in-out, 
                        padding 0.3s ease-in-out, font-size 0.3s ease-in-out, 
                        top 0.3s ease-in-out;
            pointer-events: none;
        `;
        this.speechBubble.innerHTML = "...";
        this.renderDiv.appendChild(this.speechBubble);
    }

    _setupAnimationButtons() {
        this.animationButtonsContainer = document.createElement('div');
        this.animationButtonsContainer.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            z-index: 30;
            display: none;
            flex-direction: column;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
        `;
        this.renderDiv.appendChild(this.animationButtonsContainer);
    }

    _setupInteractionModeButtons() {
        this.interactionModeContainer = document.createElement('div');
        this.interactionModeContainer.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 30;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        ['自动', '拖拽', '旋转', '缩放', '固定'].forEach(modeName => {
            const modeMap = { '自动': 'auto', '拖拽': 'drag', '旋转': 'rotate', '缩放': 'scale', '固定': 'fixed' };
            const modeId = modeMap[modeName];
            
            const button = document.createElement('button');
            button.innerText = modeName;
            button.id = `interaction-mode-${modeId}`;
            button.style.cssText = `
                padding: 10px 22px;
                font-size: 18px;
                border: 2px solid black;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
                box-shadow: 2px 2px 0px black;
            `;
            
            button.addEventListener('click', () => this._setInteractionMode(modeId));
            this.interactionModeContainer.appendChild(button);
            this.interactionModeButtons[modeId] = button;
        });

        this.renderDiv.appendChild(this.interactionModeContainer);
        this._updateInteractionModeButtonStyles();
        this._updateInstructionText();
    }

    // ========== Three.js设置 ==========
    _setupThree() {
        const width = this.renderDiv.clientWidth;
        const height = this.renderDiv.clientHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(
            width / -2, width / 2, 
            height / 2, height / -2, 
            CONFIG.camera.nearPlane, 
            CONFIG.camera.farPlane
        );
        this.camera.position.z = 100;

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.domElement.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 100%;
            max-height: 100%;
            z-index: 1;
        `;
        this.renderDiv.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, CONFIG.light.ambientIntensity);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, CONFIG.light.directionalIntensity);
        directionalLight.position.set(0, 0, 100);
        this.scene.add(directionalLight);

        this._initHandVisualization();
    }

    _initHandVisualization() {
        const initialColor = INTERACTION_MODES[this.interactionMode]?.hand || INTERACTION_MODES.auto.hand;

        this.handLineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ccff,
            linewidth: 8
        });

        this.fingertipMaterialHand1 = new THREE.MeshBasicMaterial({
            color: initialColor.clone(),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: CONFIG.hand.defaultOpacity
        });

        this.fingertipMaterialHand2 = new THREE.MeshBasicMaterial({
            color: initialColor.clone(),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: CONFIG.hand.defaultOpacity
        });

        for (let i = 0; i < 2; i++) {
            const lineGroup = new THREE.Group();
            lineGroup.visible = false;
            this.scene.add(lineGroup);

            this.hands.push({
                landmarks: null,
                anchorPos: new THREE.Vector3(),
                lineGroup: lineGroup,
                isPinching: false,
                pinchPointScreen: new THREE.Vector2(),
                isFist: false
            });
        }
    }

    // ========== 资源加载 ==========
    async _loadAssets() {
        const gltfLoader = new GLTFLoader();
        
        try {
            await new Promise((resolve, reject) => {
                gltfLoader.load(this.initialModelPath, 
                    (gltf) => this._onModelLoaded(gltf, resolve),
                    undefined,
                    reject
                );
            });
        } catch (error) {
            console.error("加载模型失败:", error);
            this._showError("加载3D模型失败");
            throw error;
        }
    }

    _onModelLoaded(gltf, resolve) {
        this.pandaModel = gltf.scene;
        this.animationMixer = new THREE.AnimationMixer(this.pandaModel);
        this.animationClips = gltf.animations;

        const config = getModelConfig(this.initialModelPath, this.renderDiv.clientHeight);

        this.pandaModel.scale.set(config.scale, config.scale, config.scale);
        this.pandaModel.userData.maxScale = config.maxScale;
        this.pandaModel.userData.minScale = config.minScale;

        this.pandaModel.position.set(0, 0, 0);
        
        if (config.centerOffset) {
            const tempBox = new THREE.Box3().setFromObject(this.pandaModel);
            const tempCenter = new THREE.Vector3();
            tempBox.getCenter(tempCenter);
            this.pandaModel.position.x = 0 - tempCenter.x;
            this.pandaModel.position.y = config.posY - tempCenter.y;
            this.pandaModel.position.z = config.posZ - tempCenter.z;
            console.log(`初始加载补偿中心偏移(XYZ): 位置=(${this.pandaModel.position.x.toFixed(2)}, ${this.pandaModel.position.y.toFixed(2)}, ${this.pandaModel.position.z.toFixed(2)})`);
        } else {
            this.pandaModel.position.set(0, config.posY, config.posZ);
        }

        this.scene.add(this.pandaModel);

        if (this.animationClips?.length) {
            this._setupModelAnimations();
        }

        // 触发模型变更事件，通知描述管理器等模块
        window.dispatchEvent(new CustomEvent('modelChanged', {
            detail: { modelPath: this.initialModelPath }
        }));

        resolve();
    }

    _setupModelAnimations() {
        this.animationClips.forEach((clip, index) => {
        const action = this.animationMixer.clipAction(clip);
        const actionName = clip.name || `Animation ${index + 1}`;
        this.animationActions[actionName] = action;

        this._createAnimationButton(actionName);
    });

    // 自动播放默认动画（如 "idle"）
    const defaultName = this._findDefaultAnimation();
    if (defaultName) {
        this.currentAction = this.animationActions[defaultName];
        this.currentAction.play();
        this._updateButtonStyles(defaultName);
    }
}    _findDefaultAnimation() {
        const actionNames = Object.keys(this.animationActions);
        const idleAction = actionNames.find(name => name.toLowerCase().includes('idle'));
        return idleAction || actionNames[0];
    }

    _createAnimationButton(actionName) {
        const button = document.createElement('button');
        const displayName = this._translateAnimationName(actionName);
        
        button.innerText = displayName;
        button.dataset.originalName = actionName;
        button.style.cssText = `
            padding: 5px 10px;
            font-size: 13px;
            background-color: #f0f0f0;
            color: black;
            border: 2px solid black;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 2px 2px 0px black;
        `;
        
        button.addEventListener('click', () => this._playAnimation(actionName));
        this.animationButtonsContainer.appendChild(button);
    }

    _translateAnimationName(englishName) {
        const lowerName = englishName.toLowerCase();
        
        for (const [key, value] of Object.entries(ANIMATION_TRANSLATIONS)) {
            if (lowerName === key.toLowerCase() || lowerName.includes(key.toLowerCase())) {
                return value;
            }
        }
        
        if (lowerName.startsWith("animation ")) {
            const num = lowerName.replace("animation ", "");
            return `动画 ${num}`;
        }
        
        return englishName;
    }

    // ========== 手势追踪设置 ==========
    async _setupHandTracking() {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
            );

            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: 'GPU'
                },
                numHands: 2,
                runningMode: 'VIDEO'
            });

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });

            this.videoElement.srcObject = stream;

            return new Promise(resolve => {
                this.videoElement.onloadedmetadata = () => {
                    resolve();
                };
            });
        } catch (error) {
            console.error('手势追踪或摄像头设置错误:', error);
            this._showError(`摄像头/手势追踪错误: ${error.message}。请允许摄像头访问。`);
            throw error;
        }
    }

    // ========== 手势更新 ==========
    _updateHands() {
        if (!this.handLandmarker || !this.videoElement.srcObject || 
            this.videoElement.readyState < 2 || this.videoElement.videoWidth === 0) {
            return;
        }

        // 如果是固定模式，则不进行手势识别
        if (this.interactionMode === 'fixed') {
            this.hands.forEach(hand => {
                if (hand.lineGroup) hand.lineGroup.visible = false;
            });
            return;
        }

        const videoTime = this.videoElement.currentTime;
        if (videoTime <= this.lastVideoTime) return;
        
        this.lastVideoTime = videoTime;

        try {
            const results = this.handLandmarker.detectForVideo(this.videoElement, performance.now());
            const videoParams = this._getVisibleVideoParameters();
            if (!videoParams) return;

            const canvasWidth = this.renderDiv.clientWidth;
            const canvasHeight = this.renderDiv.clientHeight;

            this._processHands(results, videoParams, canvasWidth, canvasHeight);
            // 处理缩放模式（手动模式）或自动模式的缩放
            if (this.interactionMode === 'scale') {
                this._handleScaleMode();
            } else if (this.interactionMode === 'auto') {
                this._handleAutoScaleModeInProcess();
            }
        } catch (error) {
            console.error("手势检测错误:", error);
        }
    }

    _processHands(results, videoParams, canvasWidth, canvasHeight) {
        for (let i = 0; i < this.hands.length; i++) {
            const hand = this.hands[i];
            
            if (results.landmarks && results.landmarks[i]) {
                const smoothedLandmarks = this._smoothLandmarks(results.landmarks[i], i);
                hand.landmarks = smoothedLandmarks;

                this._updateHandPosition(hand, smoothedLandmarks, videoParams, canvasWidth, canvasHeight);

                const prevIsPinching = hand.isPinching;
                const pinchResult = GestureDetector.detectPinch(smoothedLandmarks, videoParams, canvasWidth, canvasHeight);
                
                if (pinchResult) {
                    hand.isPinching = pinchResult.isPinching;
                    if (pinchResult.pinchPoint) {
                        hand.pinchPointScreen.set(pinchResult.pinchPoint.x, pinchResult.pinchPoint.y);
                    }
                }

                hand.isFist = GestureDetector.detectFist(smoothedLandmarks);

                this._handleInteraction(i, hand, prevIsPinching);
                this._updateHandLines(i, smoothedLandmarks, videoParams, canvasWidth, canvasHeight);
            } else {
                this._handleHandDisappeared(i, hand);
            }

            this._playInteractionSound(i, hand);
        }
    }

    _smoothLandmarks(rawLandmarks, handIndex) {
        if (!this.lastLandmarkPositions[handIndex] || 
            this.lastLandmarkPositions[handIndex].length !== rawLandmarks.length) {
            this.lastLandmarkPositions[handIndex] = rawLandmarks.map(lm => ({ ...lm }));
        }

        const smoothed = rawLandmarks.map((lm, idx) => {
            const prev = this.lastLandmarkPositions[handIndex][idx];
            const alpha = CONFIG.hand.smoothingFactor;
            return {
                x: alpha * lm.x + (1 - alpha) * prev.x,
                y: alpha * lm.y + (1 - alpha) * prev.y,
                z: alpha * lm.z + (1 - alpha) * prev.z
            };
        });

        this.lastLandmarkPositions[handIndex] = smoothed.map(lm => ({ ...lm }));
        return smoothed;
    }

    _updateHandPosition(hand, landmarks, videoParams, canvasWidth, canvasHeight) {
        const palm = landmarks[9]; // 中指MCP关节
        const screenPos = CoordinateTransformer.landmarkToScreen(palm, videoParams, canvasWidth, canvasHeight);
        hand.anchorPos.set(screenPos.x, screenPos.y, 1);
    }

    _handleInteraction(handIndex, hand, prevIsPinching) {
        if (this.interactionMode === 'fixed') {
            this._releaseModel(handIndex);
            return;
        }

        // 自动模式：根据手势自动选择操作
        if (this.interactionMode === 'auto') {
            this._handleAutoModeInteraction(handIndex, hand, prevIsPinching);
            return;
        }

        switch (this.interactionMode) {
            case 'drag':
                this._handleDragInteraction(handIndex, hand, prevIsPinching);
                break;
            case 'rotate':
                this._handleRotateInteraction(handIndex, hand, prevIsPinching);
                break;
            case 'scale':
                // 缩放模式在_handleScaleMode中处理
                break;
        }
    }

    /**
     * 自动模式交互处理：根据手势自动识别操作类型
     */
    _handleAutoModeInteraction(handIndex, hand, prevIsPinching) {
        const hand0 = this.hands[0];
        const hand1 = this.hands[1];
        
        // 检测双手二指捏合（缩放）- 优先级最高
        const bothHandsPinching = hand0?.landmarks && hand1?.landmarks && 
                                  hand0.isPinching && hand1.isPinching;
        
        if (bothHandsPinching) {
            // 检查双手距离，只有距离足够远才认为是缩放操作
            // 使用捏合点而不是手掌中心点
            const pinch0Point = hand0.pinchPointScreen;
            const pinch1Point = hand1.pinchPointScreen;
            
            // 确保捏合点已设置
            if (pinch0Point && pinch1Point) {
                const dist = pinch0Point.distanceTo(pinch1Point);
                
                // 只有当双手距离大于最小阈值时，才认为是缩放操作
                if (dist >= CONFIG.interaction.scaleMinDistance) {
                    // 双手二指捏合且距离足够 = 缩放，释放单手的操作
                    if (this.grabbingHandIndex === handIndex && this.scaleInitialPinchDistance === null) {
                        // 如果当前手正在执行其他操作，先释放
                        this._releaseModel(handIndex);
                    }
                    // 缩放操作在_processHands循环外统一处理
                    return;
                }
                // 如果双手距离太近，不认为是缩放，继续处理单手操作
            }
        }

        // 如果正在缩放，不处理单手操作
        if (this.scaleInitialPinchDistance !== null) {
            return;
        }

        // 检测单手操作（优先握拳拖拽，避免与捏合冲突）
        if (hand.landmarks) {
            if (hand.isFist) {
                // 优先握拳触发拖拽，即使同时检测到捏合
                this._handleAutoDragInteraction(handIndex, hand);
                return;
            }

            if (hand.isPinching) {
                // 单手二指捏合 = 旋转（只在单手时触发）
                const otherHand = handIndex === 0 ? hand1 : hand0;
                if (!otherHand?.isPinching) {
                    // 另一只手不在捏合，可以触发旋转
                    this._handleAutoRotateInteraction(handIndex, hand, prevIsPinching);
                } else {
                    // 另一只手也在捏合，释放当前手的操作（应该由缩放处理）
                    if (this.grabbingHandIndex === handIndex) {
                        this._releaseModel(handIndex);
                    }
                }
                return;
            }

            // 手势不明确，释放模型
            if (this.grabbingHandIndex === handIndex) {
                this._releaseModel(handIndex);
            }
        }
    }

    /**
     * 自动模式拖拽：使用握拳手势
     */
    _handleAutoDragInteraction(handIndex, hand) {
        if (hand.isFist && this.pandaModel) {
            // 使用手掌中心点作为拖拽点
            const palm = hand.landmarks[9]; // 中指MCP关节
            const videoParams = this._getVisibleVideoParameters();
            if (!videoParams) return;
            
            const canvasWidth = this.renderDiv.clientWidth;
            const canvasHeight = this.renderDiv.clientHeight;
            const palmScreen = CoordinateTransformer.landmarkToScreen(palm, videoParams, canvasWidth, canvasHeight);
            const palmPointScreen = new THREE.Vector2(palmScreen.x, palmScreen.y);

            if (this.grabbingHandIndex === -1) {
                // 开始拖拽
                this.grabbingHandIndex = handIndex;
                this.pickedUpModel = this.pandaModel;
                this.modelGrabStartDepth = this.pickedUpModel.position.z;

                const palmPoint3D = this._screenToWorld(palmPointScreen);
                palmPoint3D.z = this.modelGrabStartDepth;
                this.modelDragOffset.subVectors(this.pickedUpModel.position, palmPoint3D);
            } else if (this.grabbingHandIndex === handIndex && this.pickedUpModel) {
                // 更新拖拽位置
                const newPoint3D = this._screenToWorld(palmPointScreen);
                newPoint3D.z = this.modelGrabStartDepth;
                this.pickedUpModel.position.addVectors(newPoint3D, this.modelDragOffset);
                
                this.pickedUpModel.position.z = Math.max(
                    CONFIG.model.minZ, 
                    Math.min(CONFIG.model.maxZ, this.pickedUpModel.position.z)
                );
            }
        } else if (this.grabbingHandIndex === handIndex) {
            this._releaseModel(handIndex);
        }
    }

    /**
     * 自动模式旋转：使用二指捏合手势
     */
    _handleAutoRotateInteraction(handIndex, hand, prevIsPinching) {
        if (hand.isPinching) {
            if (!prevIsPinching && this.grabbingHandIndex === -1 && this.pandaModel) {
                // 开始旋转
                this.grabbingHandIndex = handIndex;
                this.pickedUpModel = this.pandaModel;
                this.rotateLastHandX = hand.pinchPointScreen.x;
                this.rotateLastHandY = hand.pinchPointScreen.y;
            } else if (this.grabbingHandIndex === handIndex && this.pickedUpModel && this.rotateLastHandX !== null) {
                // 更新旋转（支持X、Y轴）
                const deltaX = hand.pinchPointScreen.x - this.rotateLastHandX;
                const deltaY = hand.pinchPointScreen.y - this.rotateLastHandY;
                
                if (Math.abs(deltaX) > 0.5) {
                    this.pickedUpModel.rotation.y -= deltaX * this.rotateSensitivity;
                }
                
                if (Math.abs(deltaY) > 0.5) {
                    this.pickedUpModel.rotation.x -= deltaY * this.rotateSensitivity;
                    this.pickedUpModel.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pickedUpModel.rotation.x));
                }
                
                this.rotateLastHandX = hand.pinchPointScreen.x;
                this.rotateLastHandY = hand.pinchPointScreen.y;
            }
        } else if (prevIsPinching && this.grabbingHandIndex === handIndex) {
            this._releaseModel(handIndex);
            this.rotateLastHandX = null;
            this.rotateLastHandY = null;
        }
    }

    /**
     * 自动模式缩放：使用双手二指捏合
     */
    _handleAutoScaleMode() {
        const hand0 = this.hands[0];
        const hand1 = this.hands[1];

        if (hand0?.landmarks && hand1?.landmarks && hand0.isPinching && hand1.isPinching) {
            // 使用两个捏合点之间的距离
            const pinch0Point = hand0.pinchPointScreen;
            const pinch1Point = hand1.pinchPointScreen;
            
            // 确保捏合点已设置
            if (!pinch0Point || !pinch1Point) {
                // 捏合点未设置，结束缩放
                if (this.scaleInitialPinchDistance !== null) {
                    this.scaleInitialPinchDistance = null;
                    this.scaleInitialModelScale = null;
                    this.grabbingHandIndex = -1;
                    this.pickedUpModel = null;
                }
                return;
            }
            
            const dist = pinch0Point.distanceTo(pinch1Point);

            // 检查双手距离是否足够远
            if (dist < CONFIG.interaction.scaleMinDistance) {
                // 双手距离太近，不认为是缩放操作，结束缩放
                if (this.scaleInitialPinchDistance !== null) {
                    this.scaleInitialPinchDistance = null;
                    this.scaleInitialModelScale = null;
                    this.grabbingHandIndex = -1;
                    this.pickedUpModel = null;
                }
                return;
            }

            if (this.scaleInitialPinchDistance === null) {
                // 记录初始距离，准备开始缩放
                this.scaleInitialPinchDistance = dist;
                this.scaleInitialModelScale = this.pandaModel.scale.clone();
                this.grabbingHandIndex = 0;
                this.pickedUpModel = this.pandaModel;
            } else {
                // 继续缩放：计算距离变化
                const deltaDistance = dist - this.scaleInitialPinchDistance;
                const scaleChange = deltaDistance * this.scaleSensitivity;
                let newScale = this.scaleInitialModelScale.x + scaleChange;

                const minScale = this.pandaModel.userData?.minScale || CONFIG.model.defaultMinScale;
                const maxScale = this.pandaModel.userData?.maxScale || CONFIG.model.defaultMaxScale;
                newScale = Math.max(minScale, Math.min(maxScale, newScale));

                this.pandaModel.scale.set(newScale, newScale, newScale);
            }
        } else if (this.scaleInitialPinchDistance !== null) {
            // 结束缩放
            this.scaleInitialPinchDistance = null;
            this.scaleInitialModelScale = null;
            this.grabbingHandIndex = -1;
            this.pickedUpModel = null;
        }
    }

    _handleDragInteraction(handIndex, hand, prevIsPinching) {
        if (hand.isPinching) {
            if (!prevIsPinching && this.grabbingHandIndex === -1 && this.pandaModel) {
                // 开始拖拽
                this.grabbingHandIndex = handIndex;
                this.pickedUpModel = this.pandaModel;
                this.modelGrabStartDepth = this.pickedUpModel.position.z;

                const pinchPoint3D = this._screenToWorld(hand.pinchPointScreen);
                pinchPoint3D.z = this.modelGrabStartDepth;
                this.modelDragOffset.subVectors(this.pickedUpModel.position, pinchPoint3D);
            } else if (this.grabbingHandIndex === handIndex && this.pickedUpModel) {
                // 更新拖拽位置
                const newPoint3D = this._screenToWorld(hand.pinchPointScreen);
                newPoint3D.z = this.modelGrabStartDepth;
                this.pickedUpModel.position.addVectors(newPoint3D, this.modelDragOffset);
                
                this.pickedUpModel.position.z = Math.max(
                    CONFIG.model.minZ, 
                    Math.min(CONFIG.model.maxZ, this.pickedUpModel.position.z)
                );
            }
        } else if (prevIsPinching && this.grabbingHandIndex === handIndex) {
            this._releaseModel(handIndex);
        }
    }

    _handleRotateInteraction(handIndex, hand, prevIsPinching) {
        if (hand.isPinching) {
            if (!prevIsPinching && this.grabbingHandIndex === -1 && this.pandaModel) {
                // 开始旋转
                this.grabbingHandIndex = handIndex;
                this.pickedUpModel = this.pandaModel;
                this.rotateLastHandX = hand.pinchPointScreen.x;
                this.rotateLastHandY = hand.pinchPointScreen.y;
            } else if (this.grabbingHandIndex === handIndex && this.pickedUpModel && this.rotateLastHandX !== null) {
                // 更新旋转（支持X、Y轴）
                const deltaX = hand.pinchPointScreen.x - this.rotateLastHandX;
                const deltaY = hand.pinchPointScreen.y - this.rotateLastHandY;
                
                if (Math.abs(deltaX) > 0.5) {
                    this.pickedUpModel.rotation.y -= deltaX * this.rotateSensitivity;
                }
                
                if (Math.abs(deltaY) > 0.5) {
                    this.pickedUpModel.rotation.x -= deltaY * this.rotateSensitivity;
                    this.pickedUpModel.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pickedUpModel.rotation.x));
                }
                
                this.rotateLastHandX = hand.pinchPointScreen.x;
                this.rotateLastHandY = hand.pinchPointScreen.y;
            }
        } else if (prevIsPinching && this.grabbingHandIndex === handIndex) {
            this._releaseModel(handIndex);
            this.rotateLastHandX = null;
            this.rotateLastHandY = null;
        }
    }

    _handleScaleMode() {
        if (this.interactionMode !== 'scale') return;

        const hand0 = this.hands[0];
        const hand1 = this.hands[1];

        const bothHandsPinching = hand0?.landmarks && hand1?.landmarks && 
                                   hand0.isPinching && hand1.isPinching;

        if (bothHandsPinching) {
            const dist = hand0.pinchPointScreen.distanceTo(hand1.pinchPointScreen);

            if (this.scaleInitialPinchDistance === null) {
                // 开始缩放
                this.scaleInitialPinchDistance = dist;
                this.scaleInitialModelScale = this.pandaModel.scale.clone();
                this.grabbingHandIndex = 0;
                this.pickedUpModel = this.pandaModel;
            } else {
                // 继续缩放
                const deltaDistance = dist - this.scaleInitialPinchDistance;
                const scaleChange = deltaDistance * this.scaleSensitivity;
                let newScale = this.scaleInitialModelScale.x + scaleChange;

                const minScale = this.pandaModel.userData?.minScale || CONFIG.model.defaultMinScale;
                const maxScale = this.pandaModel.userData?.maxScale || CONFIG.model.defaultMaxScale;
                newScale = Math.max(minScale, Math.min(maxScale, newScale));

                this.pandaModel.scale.set(newScale, newScale, newScale);
            }
        } else if (this.scaleInitialPinchDistance !== null) {
            // 结束缩放
            this.scaleInitialPinchDistance = null;
            this.scaleInitialModelScale = null;
            this.grabbingHandIndex = -1;
            this.pickedUpModel = null;
        }
    }

    /**
     * 在自动模式下处理缩放（在_processHands中调用）
     */
    _handleAutoScaleModeInProcess() {
        if (this.interactionMode !== 'auto') return;
        this._handleAutoScaleMode();
    }

    _handleHandDisappeared(handIndex, hand) {
        if (this.interactionMode === 'auto') {
            // 自动模式：释放当前操作
            if (this.grabbingHandIndex === handIndex) {
                this._releaseModel(handIndex);
            }
            // 如果是缩放模式，检查是否还有双手
            if (this.scaleInitialPinchDistance !== null) {
                const hand0Exists = this.hands[0]?.landmarks;
                const hand1Exists = this.hands[1]?.landmarks;
                if (!hand0Exists || !hand1Exists) {
                    this.scaleInitialPinchDistance = null;
                    this.scaleInitialModelScale = null;
                    this.grabbingHandIndex = -1;
                    this.pickedUpModel = null;
                }
            }
        } else if (this.interactionMode === 'drag' || this.interactionMode === 'rotate') {
            if (this.grabbingHandIndex === handIndex) {
                this._releaseModel(handIndex);
            }
        } else if (this.interactionMode === 'scale' && this.scaleInitialPinchDistance !== null) {
            const hand0Exists = this.hands[0]?.landmarks;
            const hand1Exists = this.hands[1]?.landmarks;
            if (!hand0Exists || !hand1Exists) {
                this.scaleInitialPinchDistance = null;
                this.scaleInitialModelScale = null;
                this.grabbingHandIndex = -1;
                this.pickedUpModel = null;
            }
        }

        hand.landmarks = null;
        hand.isPinching = false;
        hand.isFist = false;
        if (hand.lineGroup) hand.lineGroup.visible = false;
    }

    _releaseModel(handIndex) {
        this.grabbingHandIndex = -1;
        this.pickedUpModel = null;
    }

    _playInteractionSound(handIndex, hand) {
        let isActive = false;

        if (this.interactionMode === 'auto') {
            // 自动模式：检查是否正在交互
            isActive = (this.grabbingHandIndex === handIndex && this.pickedUpModel === this.pandaModel) ||
                      (this.scaleInitialPinchDistance !== null && (handIndex === 0 || handIndex === 1));
        } else if (this.interactionMode === 'drag' || this.interactionMode === 'rotate') {
            isActive = this.grabbingHandIndex === handIndex && 
                      this.pickedUpModel === this.pandaModel;
        } else if (this.interactionMode === 'scale') {
            isActive = this.scaleInitialPinchDistance !== null && 
                      (handIndex === 0 || handIndex === 1);
        }

        if ((hand.isPinching || hand.isFist) && isActive) {
            this.audioManager.playInteractionClickSound();
        }
    }

    _screenToWorld(screenPoint) {
        const ndcX = screenPoint.x / (this.renderDiv.clientWidth / 2);
        const ndcY = screenPoint.y / (this.renderDiv.clientHeight / 2);
        const point3D = new THREE.Vector3(ndcX, ndcY, 0.5);
        point3D.unproject(this.camera);
        return point3D;
    }

    // ========== 手部可视化 ==========
    _updateHandLines(handIndex, landmarks, videoParams, canvasWidth, canvasHeight) {
        const hand = this.hands[handIndex];
        const lineGroup = hand.lineGroup;

        const isInteracting = this._isHandInteracting(handIndex);
        const material = handIndex === 0 ? this.fingertipMaterialHand1 : this.fingertipMaterialHand2;
        if (material) {
            material.opacity = isInteracting ? CONFIG.hand.grabOpacity : CONFIG.hand.defaultOpacity;
        }

        while (lineGroup.children.length) {
            const child = lineGroup.children[0];
            lineGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
        }

        if (!landmarks?.length || !videoParams) {
            lineGroup.visible = false;
            return;
        }

        const allOnScreen = landmarks.every(lm => 
            CoordinateTransformer.isLandmarkOnScreen(lm, videoParams)
        );

        if (!allOnScreen) {
            lineGroup.visible = false;
            return;
        }

        const points3D = landmarks.map(lm => {
            const screen = CoordinateTransformer.landmarkToScreen(lm, videoParams, canvasWidth, canvasHeight);
            return new THREE.Vector3(screen.x, screen.y, 1.1);
        });

        HAND_CONNECTIONS.forEach(([idx1, idx2]) => {
            const p1 = points3D[idx1]?.clone().setZ(1);
            const p2 = points3D[idx2]?.clone().setZ(1);
            if (p1 && p2) {
                const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
                const line = new THREE.Line(geometry, this.handLineMaterial);
                lineGroup.add(line);
            }
        });

        CONFIG.hand.fingertipIndices.forEach(idx => {
            const pos = points3D[idx];
            if (pos) {
                const radius = idx === 0 ? CONFIG.hand.wristRadius : CONFIG.hand.fingertipRadius;
                const geometry = new THREE.CircleGeometry(radius, CONFIG.hand.circleSegments);
                const circle = new THREE.Mesh(geometry, material);
                circle.position.copy(pos);

                // 交互时添加脉冲动画
                if (isInteracting) {
                    const pulseProgress = (1 + Math.sin(this.clock.elapsedTime * CONFIG.interaction.pulseSpeed)) / 2;
                    const scale = CONFIG.interaction.pulseBaseScale + 
                                 pulseProgress * CONFIG.interaction.pulseAmplitude;
                    circle.scale.set(scale, scale, 1);
                } else {
                    circle.scale.set(CONFIG.interaction.pulseBaseScale, CONFIG.interaction.pulseBaseScale, 1);
                }

                lineGroup.add(circle);
            }
        });

        lineGroup.visible = true;
    }

    _isHandInteracting(handIndex) {
        if (this.interactionMode === 'auto') {
            // 自动模式：检查是否正在交互
            return (this.grabbingHandIndex === handIndex && this.pickedUpModel === this.pandaModel) ||
                   (this.scaleInitialPinchDistance !== null && (handIndex === 0 || handIndex === 1));
        } else if (this.interactionMode === 'drag' || this.interactionMode === 'rotate') {
            return this.grabbingHandIndex === handIndex && this.pickedUpModel === this.pandaModel;
        } else if (this.interactionMode === 'scale') {
            return this.scaleInitialPinchDistance !== null && (handIndex === 0 || handIndex === 1);
        }
        return false;
    }

    // ========== 视频参数计算 ==========
    _getVisibleVideoParameters() {
        if (!this.videoElement || this.videoElement.videoWidth === 0 || 
            this.videoElement.videoHeight === 0) {
            return null;
        }

        const vNatW = this.videoElement.videoWidth;
        const vNatH = this.videoElement.videoHeight;
        const rW = this.renderDiv.clientWidth;
        const rH = this.renderDiv.clientHeight;

        if (vNatW === 0 || vNatH === 0 || rW === 0 || rH === 0) return null;

        const videoAR = vNatW / vNatH;
        const renderAR = rW / rH;

        let offsetX, offsetY, visibleWidth, visibleHeight;

        if (videoAR > renderAR) {
            // 视频更宽，水平裁剪
            const scale = rH / vNatH;
            const scaledVideoWidth = vNatW * scale;
            const totalCroppedX = (scaledVideoWidth - rW) / scale;
            offsetX = totalCroppedX / 2;
            offsetY = 0;
            visibleWidth = vNatW - totalCroppedX;
            visibleHeight = vNatH;
        } else {
            // 视频更高，垂直裁剪
            const scale = rW / vNatW;
            const scaledVideoHeight = vNatH * scale;
            const totalCroppedY = (scaledVideoHeight - rH) / scale;
            offsetX = 0;
            offsetY = totalCroppedY / 2;
            visibleWidth = vNatW;
            visibleHeight = vNatH - totalCroppedY;
        }

        if (visibleWidth <= 0 || visibleHeight <= 0) {
            return {
                offsetX: 0, offsetY: 0,
                visibleWidth: vNatW, visibleHeight: vNatH,
                videoNaturalWidth: vNatW, videoNaturalHeight: vNatH
            };
        }

        return {
            offsetX, offsetY, visibleWidth, visibleHeight,
            videoNaturalWidth: vNatW, videoNaturalHeight: vNatH
        };
    }

    // ========== 语音识别 ==========
    _setupSpeechRecognition() {
        // 初始化SpeechManager
        this.speechManager = new SpeechManager(
            (finalTranscript, interimTranscript) => this._onSpeechResult(finalTranscript, interimTranscript),
            (isActive) => this._onSpeechActiveChange(isActive)
        );

        // 监听其他标签页对语音识别设置的修改
        window.addEventListener('storage', (e) => {
            if (e.key === 'speechRecognitionEnabled') {
                this.speechManager.updateSpeechRecognitionState();
            }
        });

        if (this.speechBubble) {
            this.speechBubble.innerHTML = "...";
            this.speechBubble.style.opacity = '0.7';
            this._updateSpeechBubbleAppearance();
        }
    }

    // ========== 鼠标交互 ==========
    _setupMouseInteraction() {
        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 仅响应左键
            if (!this.pandaModel) return;

            const screenPoint = this._mouseToScreenPoint(e);

            if (e.ctrlKey) {
                // Ctrl + 拖拽 = 旋转
                this.mouseIsRotating = true;
                this.mouseIsDragging = false;
                this.mouseLastX = screenPoint.x;
                this.mouseLastY = screenPoint.y;
            } else {
                // 普通拖拽 = 平移
                this.mouseIsDragging = true;
                this.mouseIsRotating = false;
                this.mouseGrabScreenX = screenPoint.x;
                this.mouseGrabScreenY = screenPoint.y;
                this.mouseGrabModelPos = this.pandaModel.position.clone();
                this.mouseGrabStartDepth = this.pandaModel.position.z;
            }

            e.preventDefault();
            e.stopPropagation();
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.mouseIsDragging && !this.mouseIsRotating) return;
            if (!this.pandaModel) return;

            const screenPoint = this._mouseToScreenPoint(e);

            if (this.mouseIsRotating) {
                const deltaX = screenPoint.x - this.mouseLastX;
                const deltaY = screenPoint.y - this.mouseLastY;

                if (Math.abs(deltaX) > 0.5) {
                    this.pandaModel.rotation.y -= deltaX * this.rotateSensitivity;
                }
                if (Math.abs(deltaY) > 0.5) {
                    this.pandaModel.rotation.x -= deltaY * this.rotateSensitivity;
                    this.pandaModel.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pandaModel.rotation.x));
                }

                this.mouseLastX = screenPoint.x;
                this.mouseLastY = screenPoint.y;
            }

            if (this.mouseIsDragging) {
                const currentPoint3D = this._screenToWorld(screenPoint);
                const grabPoint3D = this._screenToWorld({ x: this.mouseGrabScreenX, y: this.mouseGrabScreenY });

                const worldDeltaX = (currentPoint3D.x - grabPoint3D.x) * this.mouseDragSensitivity;
                const worldDeltaY = (currentPoint3D.y - grabPoint3D.y) * this.mouseDragSensitivity;

                this.pandaModel.position.x = this.mouseGrabModelPos.x + worldDeltaX;
                this.pandaModel.position.y = this.mouseGrabModelPos.y + worldDeltaY;
                this.pandaModel.position.z = Math.max(
                    CONFIG.model.minZ,
                    Math.min(CONFIG.model.maxZ, this.mouseGrabModelPos.z)
                );
            }
        });

        window.addEventListener('mouseup', () => {
            this.mouseIsDragging = false;
            this.mouseIsRotating = false;
        });

        this.renderDiv.addEventListener('wheel', (e) => {
            if (!this.pandaModel) return;
            e.preventDefault();
            e.stopPropagation();

            const scaleChange = -e.deltaY * this.scaleSensitivity * 0.008 * this.mouseWheelSensitivity;
            let newScale = this.pandaModel.scale.x + scaleChange;

            const minScale = this.pandaModel.userData?.minScale || CONFIG.model.defaultMinScale;
            const maxScale = this.pandaModel.userData?.maxScale || CONFIG.model.defaultMaxScale;
            newScale = Math.max(minScale, Math.min(maxScale, newScale));

            this.pandaModel.scale.set(newScale, newScale, newScale);
        }, { passive: false });
    }

    _mouseToScreenPoint(e) {
        const rect = this.renderDiv.getBoundingClientRect();
        return {
            x: e.clientX - rect.left - this.renderDiv.clientWidth / 2,
            y: -(e.clientY - rect.top - this.renderDiv.clientHeight / 2)
        };
    }

    _onSpeechResult(finalTranscript, interimTranscript) {
        if (!this.speechBubble) return;

        clearTimeout(this.speechBubbleTimeout);

        if (finalTranscript) {
            this.speechBubble.innerHTML = finalTranscript;
            this.speechBubble.style.opacity = '1';
            this.speechBubbleTimeout = setTimeout(() => {
                this.speechBubble.innerHTML = "...";
                this.speechBubble.style.opacity = '0.7';
                this._updateSpeechBubbleAppearance();
            }, 2000);
            this._forwardSpeechToAI(finalTranscript);
        } else if (interimTranscript) {
            this.speechBubble.innerHTML = `<i style="color: #888;">${interimTranscript}</i>`;
            this.speechBubble.style.opacity = '1';
        } else {
            this.speechBubbleTimeout = setTimeout(() => {
                if (this.speechBubble.innerHTML !== "...") {
                    this.speechBubble.innerHTML = "...";
                }
                this.speechBubble.style.opacity = '0.7';
                this._updateSpeechBubbleAppearance();
            }, 500);
        }

        this._updateSpeechBubbleAppearance();
    }

    _onSpeechActiveChange(isActive) {
        this.isSpeechActive = isActive;
        this._updateSpeechBubbleAppearance();
    }

    _forwardSpeechToAI(transcript) {
        if (!this.isSpeechActive) return;
        const text = transcript?.trim();
        if (!text) return;
        const now = Date.now();
        if (text === this.lastSpeechAIText && now - this.lastSpeechAITimestamp < 1500) {
            return;
        }
        this.lastSpeechAIText = text;
        this.lastSpeechAITimestamp = now;

        if (window.aiAssistant?.submitQuestion) {
            const maybePromise = window.aiAssistant.submitQuestion(text, { source: 'speech' });
            if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch((err) => {
                    console.error('通过语音发送到AI失败:', err);
                });
            }
        }
    }

    _updateSpeechBubbleAppearance() {
        if (!this.speechBubble) return;

        const isPlaceholder = this.speechBubble.innerHTML === "..." || 
                             this.speechBubble.innerText === "...";
        const showActive = this.isSpeechActive && !isPlaceholder;

        const translateY = isPlaceholder ? '-5px' : '0px';
        const scale = showActive ? '1.15' : '1.0';
        this.speechBubble.style.transform = `translateX(-50%) translateY(${translateY}) scale(${scale})`;

        if (showActive) {
            this.speechBubble.style.boxShadow = '5px 5px 0px #007bff';
            this.speechBubble.style.padding = '18px 28px';
            this.speechBubble.style.fontSize = 'clamp(20px, 3.5vw, 26px)';
            this.speechBubble.style.top = '15px';
        } else {
            this.speechBubble.style.boxShadow = '4px 4px 0px rgba(0,0,0,1)';
            this.speechBubble.style.padding = '15px 25px';
            this.speechBubble.style.fontSize = 'clamp(16px, 3vw, 22px)';
            this.speechBubble.style.top = '10px';
        }
    }

    _showSpeechMessage(message, duration) {
        if (this.speechBubble) {
            this.speechBubble.innerHTML = message;
            this.speechBubble.style.opacity = '1';
            setTimeout(() => {
                this.speechBubble.innerHTML = "...";
                this.speechBubble.style.opacity = '0.7';
                this._updateSpeechBubbleAppearance();
            }, duration);
        }
    }

    // ========== 交互模式管理 ==========
    _setInteractionMode(mode) {
        if (this.interactionMode === mode) return;

        this.interactionMode = mode;
        this.autoModeEnabled = (mode === 'auto');

        const modeNames = { 'auto': '自动', 'drag': '拖拽', 'rotate': '旋转', 'scale': '缩放', 'fixed': '固定' };
        this.modelLoadingBubble?.showMessage(`已切换至${modeNames[mode]}操作`, 3000);

        // 释放当前抓取
        if (this.grabbingHandIndex !== -1 && this.pickedUpModel) {
            this.grabbingHandIndex = -1;
            this.pickedUpModel = null;
            this.rotateLastHandX = null;
            this.rotateLastHandY = null; // 重置Y轴追踪
            this.scaleInitialPinchDistance = null;
            this.scaleInitialModelScale = null;
        }

        this._updateHandMaterialsForMode(mode);
        this._updateInteractionModeButtonStyles();
        this._updateInstructionText();
    }

    _updateHandMaterialsForMode(mode) {
        const color = INTERACTION_MODES[mode]?.hand || new THREE.Color(0x00ccff);
        if (this.fingertipMaterialHand1) this.fingertipMaterialHand1.color.set(color);
        if (this.fingertipMaterialHand2) this.fingertipMaterialHand2.color.set(color);
    }

    _updateInteractionModeButtonStyles() {
        for (const modeKey in this.interactionModeButtons) {
            const button = this.interactionModeButtons[modeKey];
            const modeConfig = INTERACTION_MODES[modeKey];

            if (modeKey === this.interactionMode) {
                button.style.backgroundColor = modeConfig.base;
                button.style.color = modeConfig.text;
                button.style.border = `2px solid ${modeConfig.base}`;
                button.style.boxShadow = '1px 1px 0px rgba(0,0,0,0.5)';
            } else {
                button.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                button.style.color = modeConfig.base;
                button.style.border = `2px solid ${modeConfig.base}`;
                button.style.boxShadow = '2px 2px 0px rgba(0,0,0,0.5)';
            }
        }

        // 动画按钮容器始终隐藏（已移除动画功能）
        if (this.animationButtonsContainer) {
            this.animationButtonsContainer.style.opacity = '0';
            this.animationButtonsContainer.style.display = 'none';
        }
    }

    _updateInstructionText() {
        if (this.instructionTextElement) {
            const instruction = INTERACTION_MODES[this.interactionMode]?.instruction || "使用手势进行交互";
            this.instructionTextElement.innerText = instruction;
            this.instructionTextElement.style.bottom = '10px';
        }
    }

    // ========== 动画播放 ==========
    _playAnimation(name) {
        if (!this.animationActions[name]) return;

        const newAction = this.animationActions[name];
        if (this.currentAction === newAction && newAction.isRunning()) return;

        if (this.currentAction) {
            this.currentAction.fadeOut(0.5);
        }

        newAction.reset().fadeIn(0.5).play();
        this.currentAction = newAction;
        this._updateButtonStyles(name);
    }

    _updateButtonStyles(activeAnimationName) {
        const buttons = this.animationButtonsContainer.children;
        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            const isActive = button.dataset.originalName === activeAnimationName;
            
            button.style.backgroundColor = isActive ? '#007bff' : '#f0f0f0';
            button.style.color = isActive ? 'white' : 'black';
            button.style.fontWeight = isActive ? 'bold' : 'normal';
            button.style.boxShadow = isActive ? '1px 1px 0px black' : '2px 2px 0px black';
        }
    }

    // ========== 拖拽上传 ==========
    _setupDragAndDrop() {
        this.renderDiv.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            this.renderDiv.style.border = '2px dashed #007bff';
        });

        this.renderDiv.addEventListener('dragleave', () => {
            this.renderDiv.style.border = 'none';
        });

        this.renderDiv.addEventListener('drop', (e) => {
            e.preventDefault();
            this.renderDiv.style.border = 'none';

            if (e.dataTransfer.files?.length > 0) {
                const file = e.dataTransfer.files[0];
                const fileName = file.name.toLowerCase();
                const fileType = file.type.toLowerCase();

                if (fileName.endsWith('.gltf') || fileName.endsWith('.glb') || 
                    fileType === 'model/gltf+json' || fileType === 'model/gltf-binary') {
                    this._loadDroppedModel(file);
                } else {
                    this._showTemporaryMessage(`"${file.name}" 不是GLTF模型`, 3000);
                }
            }
        });
    }

    _loadDroppedModel(file) {
        const reader = new FileReader();

        reader.onload = (e) => {
            this._parseAndLoadGltf(e.target.result, file.name, file.type);
        };

        reader.onerror = (error) => {
            console.error(`读取文件错误 ${file.name}:`, error);
            this._showError(`读取文件 ${file.name} 失败`);
        };

        const fileNameLower = file.name.toLowerCase();
        const fileTypeLower = file.type?.toLowerCase() || '';

        if (fileNameLower.endsWith('.glb') || fileTypeLower === 'model/gltf-binary') {
            reader.readAsArrayBuffer(file);
        } else if (fileNameLower.endsWith('.gltf') || fileTypeLower === 'model/gltf+json') {
            reader.readAsText(file);
        } else {
            this._showError(`不支持的文件类型: ${file.name}`);
        }
    }

    _parseAndLoadGltf(content, fileName, fileType) {
        const loader = new GLTFLoader();

        try {
            loader.parse(content, '', 
                (gltf) => this._replaceModelWithLoaded(gltf, fileName),
                (error) => {
                    console.error(`解析GLTF模型失败 ${fileName}:`, error);
                    this._showError(`解析 "${fileName}" 失败。模型可能损坏或不受支持。`);
                }
            );
        } catch (e) {
            console.error(`GLTF解析设置错误 ${fileName}:`, e);
            this._showError(`设置解析器失败 "${fileName}"`);
        }
    }

    _replaceModelWithLoaded(gltf, fileName) {
        // 移除旧模型
        if (this.pandaModel) {
            this.scene.remove(this.pandaModel);
            if (this.animationMixer) {
                this.animationMixer.stopAllAction();
                this.currentAction = null;
            }
            while (this.animationButtonsContainer.firstChild) {
                this.animationButtonsContainer.removeChild(this.animationButtonsContainer.firstChild);
            }
            this.animationActions = {};
            this.animationClips = [];
        }

        // 设置新模型
        this.pandaModel = gltf.scene;
        const scale = 80;
        this.pandaModel.scale.set(scale, scale, scale);
        
        const sceneHeight = this.renderDiv.clientHeight;
        this.pandaModel.position.set(0, sceneHeight * CONFIG.model.positionYFactor, CONFIG.model.positionZ);
        
        this.scene.add(this.pandaModel);

        // 设置动画
        this.animationMixer = new THREE.AnimationMixer(this.pandaModel);
        this.animationClips = gltf.animations;
        this.animationActions = {};

        if (this.animationClips?.length) {
            this._setupModelAnimations();
        }

        // 重置交互状态
        this.grabbingHandIndex = -1;
        this.pickedUpModel = null;
        this.rotateLastHandX = null;
        this.rotateLastHandY = null; // 重置Y轴追踪
        this.scaleInitialPinchDistance = null;
        this.scaleInitialModelScale = null;

        this._updateInteractionModeButtonStyles();
    }

    // ========== 窗口调整 ==========
    _onResize() {
        const width = this.renderDiv.clientWidth;
        const height = this.renderDiv.clientHeight;

        this.camera.left = width / -2;
        this.camera.right = width / 2;
        this.camera.top = height / 2;
        this.camera.bottom = height / -2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    // ========== 动画循环 ==========
    _animate() {
        requestAnimationFrame(this._animate.bind(this));

        const deltaTime = this.clock.getDelta();

        if (this.gameState === 'tracking') {
            this._updateHands();
        }

        if (this.animationMixer) {
            this.animationMixer.update(deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }

    // ========== UI消息显示 ==========
    _showStatusScreen(message, color = 'white', showRestartHint = false) {
        this.gameOverContainer.style.display = 'block';
        this.gameOverText.innerText = message;
        this.gameOverText.style.color = color;
        this.restartHintText.style.display = showRestartHint ? 'block' : 'none';
    }

    _showError(message) {
        this.gameOverContainer.style.display = 'block';
        this.gameOverText.innerText = `错误: ${message}`;
        this.gameOverText.style.color = 'orange';
        this.restartHintText.style.display = 'block';
        this.gameState = 'error';

        this.hands.forEach(hand => {
            if (hand.lineGroup) hand.lineGroup.visible = false;
        });
    }

    _showTemporaryMessage(message, duration) {
        this._showStatusScreen(message, 'orange', false);
        setTimeout(() => {
            if (this.gameOverContainer.style.display === 'block' && 
                this.gameOverText.innerText.includes(message)) {
                this.gameOverContainer.style.display = 'none';
            }
        }, duration);
    }

    _restartGame() {
        this.gameOverContainer.style.display = 'none';
        this.hands.forEach(hand => {
            if (hand.lineGroup) hand.lineGroup.visible = false;
        });

        this.gameState = 'tracking';
        this.lastVideoTime = -1;
        this.clock.start();
    }

    // ========== 启动 ==========
    start() {
        this.renderDiv.addEventListener('click', () => {
            this.audioManager.resumeContext();
            if (this.gameState === 'error' || this.gameState === 'paused') {
                this._restartGame();
            }
        });
    }

    // ========== 资源清理 ==========
    dispose() {
        // 清理场景中的几何体和材质
        this.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });

        // 停止摄像头
        if (this.videoElement?.srcObject) {
            this.videoElement.srcObject.getTracks().forEach(track => track.stop());
        }

        // 移除事件监听器
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('storage', this._setupStorageListener);

        // 清理子管理器
        if (this.speechManager) this.speechManager.dispose?.();
        if (this.audioManager) this.audioManager.dispose?.();
    }
}