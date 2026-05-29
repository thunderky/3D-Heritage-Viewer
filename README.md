# 3D-Heritage-Viewer (3D数字文物展馆)

**3D数字文物展馆** 是一个前沿的Web应用，致力于通过沉浸式和交互式技术，将珍贵的文化遗产带入数字时代。本项目不仅提供了高保真的3D文物模型展示，更集成了手势识别、语音控制和AI问答等自然交互功能，为用户打造了前所未有的博物馆级探索体验。

## 🚀 快速启动

本项目依赖 **Python 3** 环境来启动本地服务。

1.  **环境准备**:
    *   请确保您的计算机已安装 Python 3。
    *   推荐使用最新版本的 Google Chrome 或 Microsoft Edge 浏览器以获得最佳体验。

2.  **一键启动**:
    *   直接双击项目根目录下的 `play.bat` 批处理文件。

3.  **服务状态**:
    *   脚本将自动启动两个服务窗口：
        *   **Web服务器**: 运行于 `http://localhost:8000`，负责托管前端页面。
        *   **AI代理服务器**: 运行于 `http://localhost:8001`，作为AI问答功能的安全中间层。
    *   **请保持这两个窗口的运行状态**，关闭它们将导致相应功能失效。

4.  **开始探索**:
    *   在浏览器中打开以下地址，即可进入展馆首页：
        > **http://localhost:8000/pages/index.html**

---

## ✨核心功能详解

### 1. 沉浸式3D交互

利用 **Three.js** 渲染引擎，我们实现了流畅、高性能的3D模型查看器。

-   **自由探索**: 用户可以通过鼠标拖拽、滚轮缩放等传统方式，360°无死角地观察文物细节。
-   **动态加载**: 支持从配置文件动态加载和切换不同的GLTF模型。
-   **性能优化**: 对模型加载、渲染循环和资源回收进行了优化，确保在普通计算机上也能流畅运行。

### 2. 自然用户界面 (Natural User Interface)

我们致力于让技术“隐身”，使用户能以最自然的方式与数字内容互动。

#### 手势控制

通过 **Google MediaPipe** 的手势识别技术，您的双手就是控制器。

-   **拖拽与移动**: 握拳手势 (`fist`) 可“抓住”并拖动模型。
-   **旋转**: 张开手掌 (`open_palm`) 可自由旋转模型。
-   **缩放**: 捏合食指与拇指 (`pinch`) 可对模型进行放大和缩小。
-   **固定视角**: 特定手势可锁定或解锁模型的自动旋转。

#### 语音命令

通过浏览器内置的 **Web Speech API**，您可以直接“命令”文物。

-   **支持的命令**:
    -   `旋转` / `转动`
    -   `缩放` / `放大` / `缩小`
    -   `拖拽` / `拖动`
    -   `固定` / `锁定`
-   **实时反馈**: 系统会实时识别您的语音指令并执行相应操作。

### 3. AI智能问答

每个文物都配有一位“博学”的AI讲解员。

-   **知识引擎**: 基于阿里巴巴的 **“通义千问”** 大语言模型，提供专业、丰富的背景知识。
-   **安全代理**: 前端的所有AI请求都通过本地的Python代理服务器 (`ai-proxy.py`)转发，有效避免了API密钥在浏览器端的暴露，并解决了跨域（CORS）问题。
-   **上下文感知**: AI助手能够理解当前正在展示的文物，并围绕其展开问答。

### 4. 丰富的文化内容

-   **中华文明时间线**: 在 `dynasty.html` 页面中，我们以可视化的时间轴串联起中华文明的关键时期，用户可以点击进入相应时代的文物展厅。
-   **互动评论区**: 每个文物下方都设有独立的评论系统，用户可以发表见解，与其他访客交流心得，所有评论数据均保存在本地（LocalStorage）。

---

## 🛠️ 技术架构与实现

-   **前端**:
    -   **语言**: HTML5, CSS3, JavaScript (ES6+)
    -   **3D渲染**: `Three.js`
    -   **手势识别**: `Google MediaPipe Tasks Vision`
    -   **语音识别**: `Web Speech API`
-   **后端 (本地服务)**:
    -   **语言**: `Python 3`
    -   **Web服务器**: `http.server` 模块，用于静态文件托管。
    -   **AI代理**: 基于 `http.server` 的自定义代理，用于请求转发和API密钥保护。
-   **AI服务**:
    -   **模型**: 阿里巴巴通义千问 (`qwen-turbo`)

### 📂 项目结构

```
/
├── assets/               # 3D模型资源 (gltf, bin, textures)
├── data/                 # JSON数据 (如文物描述: descriptions.json)
├── docs/                 # 项目相关文档
├── images/               # 网站图片资源
├── pages/                # HTML页面 (index.html, main.html, etc.)
├── scripts/              # JavaScript 核心逻辑
│   ├── game.js           # 主场景、手势与Three.js核心控制
│   ├── aiAssistant.js    # AI助手前端逻辑
│   ├── SpeechManager.js  # 语音识别封装
│   ├── modelConfig.js    # 模型位置、缩放等配置文件
│   └── ...
├── styles/               # CSS样式表
├── play.bat              # Windows一键启动脚本
└── README.md             # 本说明文件
```

---

## 🔧 自定义与扩展

### 添加新文物

1.  **模型文件**: 将您的 `gltf` 模型文件夹（包含模型、贴图等）放入 `assets/` 目录下。
2.  **配置缩放与位置**: 打开 `scripts/modelConfig.js`，为您的新模型添加一条配置记录，用于定义其初始缩放、位置等参数。
    ```javascript
    'your-model-folder-name': {
        scale: 100,
        maxScale: 500,
        minScale: 10,
        posY: -50,
        centerOffset: true
    },
    ```
3.  **添加描述信息**: 打开 `data/descriptions.json`，为新模型添加标题、年代、分类和详细描述。
    ```json
    "your-model-folder-name": {
      "title": "您的文物名称",
      "dynasty": "所属朝代",
      "category": "文物分类",
      "description": "关于这件文物的详细介绍..."
    }
    ```
4.  **更新模型列表**: （如果需要）在 `pages/main.html` 的模型选择下拉菜单中添加新模型的选项。

### 修改AI配置

-   **更换API密钥**: 请编辑 `scripts/ai-proxy.config.json`，把 `api_key` 替换为您自己的通义千问或 DeepSeek 密钥。
-   **注意**: 这个配置文件已经加入 `.gitignore`，不会被提交到仓库。

        ```json
        {
            "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "api_endpoint": "https://api.deepseek.com/chat/completions",
            "api_provider": "deepseek"
        }
        ```
