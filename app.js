// Emotional Resonance // 感情共鳴インタラクティブアート・エンジン

// === 1. グローバル状態管理 ===
let isSystemReady = false;
let isStarted = false;
let webcamStream = null;

// 顔認識データ (0.0 〜 1.0)
let emotionData = {
    happy: 0,
    sad: 0,
    angry: 0,
    surprised: 0,
    neutral: 1.0 // 初期値は平穏
};

// 補間（スムージング）された感情データ（ヌルヌル動かす用）
let smoothEmotion = { happy: 0, sad: 0, angry: 0, surprised: 0, neutral: 1.0 };
const LERP_FACTOR = 0.08; // 補間速度（小さいほど滑らか）

// カメラから検出した顔の位置情報
let faceTarget = { x: 0, y: 0, size: 150, active: false };
let smoothFace = { x: 0, y: 0, size: 150 };
let realFaceSize = 120; // 誤検出防止の顔除外領域用の本来の顔スケール

// === 【ジェスチャートレース】仮想手トラッキング（モーション重心追跡システム） ===
let leftHandTarget = { x: 0, y: 0, active: false, lastActiveTime: 0 };
let rightHandTarget = { x: 0, y: 0, active: false, lastActiveTime: 0 };
let smoothLeftHand = { x: 0, y: 0, active: false, alpha: 0 };
let smoothRightHand = { x: 0, y: 0, active: false, alpha: 0 };

// === 【引きの視点】キャンバスの中心寄りに綺麗にマッピングするためのマージン ===
let mapMarginX = 0;
let mapMarginY = 0;

// === 【3Dカメラシステム】アングルを自動でゆっくり旋回させる角度 ===
let angleY = 0; // 左右の自転角度
let angleX = 0.12; // 上下のたゆたい角度
const fov = 400; // 3Dパースペクティブ投影の視野角

// === 【3Dカメラシステム】マウスドラッグ・タッチ操作による3D空間回転用の制御変数 ===
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let mouseAngleX = 0;
let mouseAngleY = 0;
let targetMouseAngleX = 0;
let targetMouseAngleY = 0;
let renderAngleY = 0; // 自転とマウス移動を合成した最終描画Y角度
let userZoom = 1.0; // ユーザー操作によるベースカメラズーム倍率 (マウスホイール、ピンチ対応)
let targetUserZoom = 1.0;
let finalZoom = 1.0; // 最終的にレンダリングで適用される合成カメラズーム倍率


// モーションディテクション用バッファ
const motionCanvas = document.createElement('canvas');
motionCanvas.width = 48; // パフォーマンス最優先の軽量解像度
motionCanvas.height = 36;
const motionCtx = motionCanvas.getContext('2d');
let prevFrame = null;
let activeMotionPoints = []; 

// WebAudio API
let audioCtx = null;
let micStream = null;
let analyser = null;
let synthOscillators = [];
let synthGains = [];
let masterVolume = null;

// 追加の音響エフェクトノード（感情表現のブースト用）
let audioFilter = null;
let audioCleanGain = null;
let audioDistortionNode = null;
let audioDistortionGain = null;
let audioDelaySurprised = null;
let audioDelayGainSurprised = null;
let audioDelaySad = null;
let audioDelayGainSad = null;
let audioPanner = null;
let audioFeedbackSad = null;         // 悲しみのスペースフィードバック
let audioFeedbackSurprised = null;   // 驚きのスラップバックフィードバック
let smoothMotionStrength = 0;        // 全身モーション強度補間用
let curveCache = {};                 // ディストーションカーブのキャッシュ

// Canvasアート
const canvas = document.getElementById('art-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
const PARTICLE_COUNT = 420; // パーティクル数

// DOM要素
const startOverlay = document.getElementById('start-overlay');
const btnEnter = document.getElementById('btn-enter');
const mainUi = document.getElementById('main-ui');
const webcam = document.getElementById('webcam');
const systemStatus = document.getElementById('system-status');
const statusText = document.getElementById('status-text');
const btnToggleCamera = document.getElementById('btn-toggle-camera');
const micSensitivity = document.getElementById('mic-sensitivity');
const artStatusDesc = document.getElementById('art-status-desc');
const audioWaveBars = document.getElementById('audio-wave-bars');

// === 2. システム初期化 ＆ face-api.js のロード ===
async function initSystem() {
    try {
        console.log("Loading face-api.js models...");
        const MODEL_URL = './models';
        
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
        
        console.log("Models loaded successfully!");
        isSystemReady = true;
        
        // ステータスを「準備完了」に
        systemStatus.querySelector('.status-dot').className = 'status-dot green';
        statusText.textContent = '準備完了';
        btnEnter.removeAttribute('disabled');
        btnEnter.querySelector('span').textContent = 'アート空間を起動する';
    } catch (err) {
        console.error("System initialization failed:", err);
        statusText.textContent = 'エラーが発生しました';
        systemStatus.querySelector('.status-dot').className = 'status-dot red';
        alert('顔認識モデルの読み込みに失敗しました。ページをリロードしてみてください。');
    }
}

// ページロード時に即座に初期化
window.addEventListener('DOMContentLoaded', () => {
    btnEnter.setAttribute('disabled', 'true');
    btnEnter.querySelector('span').textContent = 'モデル読み込み中...';
    
    // オーディオビジュアライザーの波形バーを16個作成
    for (let i = 0; i < 16; i++) {
        const bar = document.createElement('div');
        bar.className = 'wave-bar';
        audioWaveBars.appendChild(bar);
    }
    
    initSystem();
    setupCanvas();
    
    // 初期位置を設定（引きのデフォルト）
    const initX = window.innerWidth / 2;
    const initY = window.innerHeight * 0.35; // 引きの構図なので少し上に配置
    faceTarget.x = initX;
    faceTarget.y = initY;
    smoothFace.x = initX;
    smoothFace.y = initY;
    
    smoothLeftHand.x = initX - 100;
    smoothLeftHand.y = initY + 150;
    smoothRightHand.x = initX + 100;
    smoothRightHand.y = initY + 150;
});

// Canvasサイズ設定 ＆ 引きの視点用マージン計算
function setupCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // === 【極限引きの視点】全身がすっぽり中央に収まる上品なマージン（左右35%, 上下30%） ===
    mapMarginX = canvas.width * 0.35;
    mapMarginY = canvas.height * 0.30;
}
window.addEventListener('resize', setupCanvas);


// === 3. アート空間の起動 (カメラ & マイクの開始) ===
btnEnter.addEventListener('click', async () => {
    if (!isSystemReady || isStarted) return;
    
    try {
        // カメラとマイクのメディア許可を取得
        webcamStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 320, height: 240, frameRate: { ideal: 15 } } 
        });
        
        micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true 
        });
        
        // ビデオ要素にストリームをアタッチ
        webcam.srcObject = webcamStream;
        
        // WebAudioの初期化
        initAudio();
        
        // UIの切り替え
        startOverlay.style.display = 'none';
        mainUi.classList.remove('hidden');
        isStarted = true;
        
        // 顔認識ループとアニメーションループを開始
        startFaceTracking();
        animate();
        
    } catch (err) {
        console.error("Media access denied:", err);
        alert('カメラまたはマイクの許可が得られませんでした。このアート作品の体験にはカメラとマイクへのアクセスが必要です。');
    }
});


// === 4. 表情トラッキング (face-api.js Loop) ===
function startFaceTracking() {
    setInterval(async () => {
        if (!isStarted || webcam.paused || webcam.ended) return;
        
        const detection = await faceapi.detectSingleFace(
            webcam, 
            new faceapi.TinyFaceDetectorOptions()
        ).withFaceExpressions();
        
        if (detection) {
            const expressions = detection.expressions;
            
            // 感情データの更新 (怒りは微妙な表情変化でも反応しやすくなるよう、2.5倍にブースト＋感度底上げを適用)
            emotionData.happy = expressions.happy || 0;
            emotionData.sad = expressions.sad || 0;
            const rawAngry = expressions.angry || 0;
            emotionData.angry = Math.min(1.0, rawAngry * 2.5 + (rawAngry > 0.04 ? 0.25 : 0));
            emotionData.surprised = expressions.surprised || 0;
            emotionData.neutral = expressions.neutral || 0;
            
            // 顔位置の更新 (鏡像表示なので x は反転)
            const box = detection.detection.box;
            const normX = 1.0 - (box.x + box.width / 2) / 320;
            const normY = (box.y + box.height / 2) / 240;
            
            // === 【最適なデフォルト・ズーム】スクリーンショットに完全合致する、画面に対して存在感のある美しい拡大ズームサイズ ===
            faceTarget.x = mapMarginX + normX * (canvas.width - mapMarginX * 2);
            faceTarget.y = mapMarginY * 0.70 + normY * (canvas.height - mapMarginY * 2) * 0.35; // 安定して中央上寄りに配置
            
            // アバターが画面縦幅の約60%を美しく占める、迫力のある拡大サイズ
            const rawSize = (box.width / 320) * canvas.width * 0.46;
            faceTarget.size = Math.max(120, Math.min(195, rawSize)); 
            
            // 誤検出防止マスク用の実際の顔サイズ（比率基準）
            realFaceSize = (box.width / 320) * canvas.width * 0.70;
            faceTarget.active = true;
            
            // 最も強い感情に基づいてステータス文を変更
            let maxEmotion = 'neutral';
            let maxVal = emotionData.neutral;
            for (const [key, val] of Object.entries(emotionData)) {
                if (val > maxVal) {
                    maxVal = val;
                    maxEmotion = key;
                }
            }
            updateArtDescription(maxEmotion, maxVal);
        } else {
            // 顔が見つからない場合は徐々に平穏に戻す
            emotionData.happy = 0;
            emotionData.sad = 0;
            emotionData.angry = 0;
            emotionData.surprised = 0;
            emotionData.neutral = 0.5;
            
            faceTarget.active = false;
            realFaceSize += (120 - realFaceSize) * 0.1;
        }
    }, 100); // 100msごとに顔認識（レスポンスを1.5倍高速化）
}

// 感情に合わせた説明文の動的アップデート
function updateArtDescription(emotion, val) {
    if (val < 0.2) {
        artStatusDesc.textContent = "静かにあなたの全身のオーラと対話しています。";
        return;
    }
    
    switch (emotion) {
        case 'happy':
            artStatusDesc.textContent = "😊 【喜び】が共鳴しています。宇宙の深淵に浮かぶ全身のシルエットが温かく輝き、心躍る明るい和音が響いています。";
            break;
        case 'sad':
            artStatusDesc.textContent = "😢 【哀しみ】を感知しました。しっとりとした青いオーラが頭からつま先、伸ばした手先までを包み、深く穏やかなメロディが流れます。";
            break;
        case 'angry':
            artStatusDesc.textContent = "😡 【情熱と葛藤】が渦巻いています。全身の輪郭から激しい紅いオーラが弾け飛び、あなたのジェスチャーを激しくなぞります。";
            break;
        case 'surprised':
            artStatusDesc.textContent = "😮 【驚き】が空間を揺らしました。あなたの全身から大きな光の波紋が周囲に放たれ、浮遊感のある不思議な音が生まれています。";
            break;
        default:
            artStatusDesc.textContent = "😐 【平穏】が満ちています。淡いエメラルドグリーンの光の霧が、全身のラインをたゆたうように流れ、心地よいドローン音が響いています。";
    }
}


// === 5. モーション検出 ＆ 左右のジェスチャー（手）の重心追跡（引きのマッピング連動） ===
function detectMotion() {
    if (!isStarted || webcam.paused || webcam.ended) return;
    
    motionCtx.drawImage(webcam, 0, 0, motionCanvas.width, motionCanvas.height);
    const currentFrame = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
    const currentPixels = currentFrame.data;
    
    activeMotionPoints = [];
    
    let leftSumX = 0, leftSumY = 0, leftCount = 0;
    let rightSumX = 0, rightSumY = 0, rightCount = 0;
    
    // 顔の輪郭（バウンディングボックス）領域
    const faceR = realFaceSize * 0.48; // 小さく縮小されたサイズではなく、実際の顔のサイズを使う！
    const faceLeft = smoothFace.x - faceR * 1.5;
    const faceRight = smoothFace.x + faceR * 1.5;
    const faceTop = smoothFace.y - faceR * 1.3;
    const faceBottom = smoothFace.y + faceR * 1.8; 
    
    if (prevFrame) {
        const prevPixels = prevFrame.data;
        
        for (let y = 0; y < motionCanvas.height; y++) {
            for (let x = 0; x < motionCanvas.width; x++) {
                const idx = (y * motionCanvas.width + x) * 4;
                
                const diff = (
                    Math.abs(currentPixels[idx] - prevPixels[idx]) +
                    Math.abs(currentPixels[idx+1] - prevPixels[idx+1]) +
                    Math.abs(currentPixels[idx+2] - prevPixels[idx+2])
                ) / 3;
                
                if (diff > 35) { // 感度閾値
                    const normX = 1.0 - (x / motionCanvas.width);
                    const normY = y / motionCanvas.height;
                    
                    // ジェスチャー検出座標も顔と同じく中央縮小マッピング（全身を完璧に収める）
                    const px = mapMarginX + normX * (canvas.width - mapMarginX * 2);
                    const py = mapMarginY * 0.75 + normY * (canvas.height - mapMarginY * 2) * 0.30;
                    
                    activeMotionPoints.push({ x: px, y: py, intensity: diff / 255 });
                    
                    // 顔の周辺エリア内にある動きを除外
                    const isInFaceArea = (px > faceLeft && px < faceRight && py > faceTop && py < faceBottom);
                    
                    if (!isInFaceArea) {
                        // 首・胸より上の高い位置にある動き（手を上げるなど）の場合、顔に横方向で近くても中心線を境に左右の手として分類
                        if (py < smoothFace.y + faceR * 2.0) {
                            if (px < smoothFace.x) {
                                leftSumX += px;
                                leftSumY += py;
                                leftCount++;
                            } else {
                                rightSumX += px;
                                rightSumY += py;
                                rightCount++;
                            }
                        } else {
                            // 顔より左側の動き（胸より下）
                            if (px < smoothFace.x - faceR * 0.8) {
                                leftSumX += px;
                                leftSumY += py;
                                leftCount++;
                            }
                            // 顔より右側の動き（胸より下）
                            else if (px > smoothFace.x + faceR * 0.8) {
                                rightSumX += px;
                                rightSumY += py;
                                rightCount++;
                            }
                        }
                    }
                }
            }
        }
    }
    prevFrame = currentFrame;
    
    const now = Date.now();
    const minPointsForHand = 3; 
    
    // 画面の幅に対する、骨格サイズ（smoothFace.size）の割合
    // ユーザーの手の動き（dx, dy）を、極小の骨格モデルに完璧にフィットさせるスケーリング（140pxを基準）
    const scaleFactor = smoothFace.size / 140; 
    
    // 【左手追跡】
    if (leftCount >= minPointsForHand) {
        const rawLX = leftSumX / leftCount;
        const rawLY = leftSumY / leftCount;
        
        // 顔（中心）からの相対距離
        const dx = rawLX - smoothFace.x;
        const dy = rawLY - smoothFace.y;
        
        // 骨格モデルの縮小スケールに合わせて、相対座標をスケーリングして適用
        leftHandTarget.x = smoothFace.x + dx * scaleFactor;
        leftHandTarget.y = smoothFace.y + dy * scaleFactor;
        
        // 手が肩から不自然に離れすぎないように可動域制限
        const maxRange = smoothFace.size * 3.5;
        const dist = Math.sqrt(dx*dx + dy*dy) * scaleFactor;
        if (dist > maxRange && dist > 0) {
            leftHandTarget.x = smoothFace.x + (dx * scaleFactor / dist) * maxRange;
            leftHandTarget.y = smoothFace.y + (dy * scaleFactor / dist) * maxRange;
        }
        
        leftHandTarget.active = true;
        leftHandTarget.lastActiveTime = now;
    } else if (now - leftHandTarget.lastActiveTime > 1200) {
        leftHandTarget.active = false;
    }
    
    // 【右手追跡】
    if (rightCount >= minPointsForHand) {
        const rawRX = rightSumX / rightCount;
        const rawRY = rightSumY / rightCount;
        
        // 顔からの相対距離
        const dx = rawRX - smoothFace.x;
        const dy = rawRY - smoothFace.y;
        
        // 骨格モデルの縮小スケールに合わせて、相対座標をスケーリングして適用
        rightHandTarget.x = smoothFace.x + dx * scaleFactor;
        rightHandTarget.y = smoothFace.y + dy * scaleFactor;
        
        // 可動域制限
        const maxRange = smoothFace.size * 3.5;
        const dist = Math.sqrt(dx*dx + dy*dy) * scaleFactor;
        if (dist > maxRange && dist > 0) {
            rightHandTarget.x = smoothFace.x + (dx * scaleFactor / dist) * maxRange;
            rightHandTarget.y = smoothFace.y + (dy * scaleFactor / dist) * maxRange;
        }
        
        rightHandTarget.active = true;
        rightHandTarget.lastActiveTime = now;
    } else if (now - rightHandTarget.lastActiveTime > 1200) {
        rightHandTarget.active = false;
    }
}


// === 6. WebAudio API シンセサイザー ＆ ビジュアライザー ===

// WaveShaper用のディストーションカーブ生成（怒りエフェクト用）
function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // マイク解析器
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64; // 軽量化
    source.connect(analyser);
    
    // マスターボリューム
    masterVolume = audioCtx.createGain();
    masterVolume.gain.setValueAtTime(0.3, audioCtx.currentTime); // 全体の最大音量を制限
    masterVolume.connect(audioCtx.destination);

    // === 音響エフェクトグラフ of 構築 ===

    // 6. グローバル・ステレオパンナー（驚きや動きでの高速ステレオ変調用）
    audioPanner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    if (audioPanner) {
        audioPanner.pan.setValueAtTime(0.0, audioCtx.currentTime);
        audioPanner.connect(masterVolume);
    }
    const finalDest = audioPanner ? audioPanner : masterVolume;

    // 1. ローパス・フィルター
    audioFilter = audioCtx.createBiquadFilter();
    audioFilter.type = 'lowpass';
    audioFilter.frequency.setValueAtTime(1500, audioCtx.currentTime);

    // 2. クリーン（エフェクトなし）経路
    audioCleanGain = audioCtx.createGain();
    audioCleanGain.gain.setValueAtTime(1.0, audioCtx.currentTime);
    audioFilter.connect(audioCleanGain);
    audioCleanGain.connect(finalDest);

    // 3. ディストーション（怒り）経路
    audioDistortionNode = audioCtx.createWaveShaper();
    audioDistortionNode.curve = makeDistortionCurve(120); // 激しめの歪み
    audioDistortionNode.oversample = '4x';
    audioDistortionGain = audioCtx.createGain();
    audioDistortionGain.gain.setValueAtTime(0.0, audioCtx.currentTime); // 初期状態は消音
    
    audioFilter.connect(audioDistortionNode);
    audioDistortionNode.connect(audioDistortionGain);
    audioDistortionGain.connect(finalDest);

    // 4. サプライズ用スラップバック・ディレイ（短いエコー）
    audioDelaySurprised = audioCtx.createDelay(1.0);
    audioDelaySurprised.delayTime.setValueAtTime(0.12, audioCtx.currentTime); // 短めのディレイ
    audioDelayGainSurprised = audioCtx.createGain();
    audioDelayGainSurprised.gain.setValueAtTime(0.0, audioCtx.currentTime);
    
    // スラップバック・フィードバックループ
    audioFeedbackSurprised = audioCtx.createGain();
    audioFeedbackSurprised.gain.setValueAtTime(0.35, audioCtx.currentTime);
    audioDelaySurprised.connect(audioFeedbackSurprised);
    audioFeedbackSurprised.connect(audioDelaySurprised);

    audioFilter.connect(audioDelaySurprised);
    audioDelaySurprised.connect(audioDelayGainSurprised);
    audioDelayGainSurprised.connect(finalDest);

    // 5. 悲しみ用スペース・ディレイ（深く、長く減衰するエコー）
    audioDelaySad = audioCtx.createDelay(2.0);
    audioDelaySad.delayTime.setValueAtTime(0.55, audioCtx.currentTime); // ゆったりしたディレイ
    audioDelayGainSad = audioCtx.createGain();
    audioDelayGainSad.gain.setValueAtTime(0.0, audioCtx.currentTime);
    
    // スペースディレイ・フィードバックループ
    audioFeedbackSad = audioCtx.createGain();
    audioFeedbackSad.gain.setValueAtTime(0.65, audioCtx.currentTime); // 長いディレイテール
    audioDelaySad.connect(audioFeedbackSad);
    audioFeedbackSad.connect(audioDelaySad);

    audioFilter.connect(audioDelaySad);
    audioDelaySad.connect(audioDelayGainSad);
    audioDelayGainSad.connect(finalDest);
    
    // シンセ用和音の発振器（5つの音を合成して豊かなドローンを作る）
    const synthCount = 5;
    for (let i = 0; i < synthCount; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = i % 2 === 0 ? 'sine' : 'triangle'; // 初期状態はサイン波と三角波
        osc.frequency.setValueAtTime(110, audioCtx.currentTime); // ダミー初期周波数
        
        gain.gain.setValueAtTime(0, audioCtx.currentTime); // 最初はミュート
        
        osc.connect(gain);
        gain.connect(audioFilter); // すべてのシンセ出力をフィルターへ接続
        osc.start();
        
        synthOscillators.push(osc);
        synthGains.push(gain);
    }
}

// 感情と周波数（コード）の対応定義
const CHORD_HAPPY = [261.63, 329.63, 392.00, 493.88, 587.33];
const CHORD_SAD = [220.00, 261.63, 329.63, 392.00, 523.25];
const CHORD_ANGRY = [146.83, 207.65, 277.18, 369.99, 523.25];
const CHORD_SURPRISED = [174.61, 233.08, 261.63, 311.13, 392.00];
const CHORD_NEUTRAL = [98.00, 146.83, 196.00, 220.00, 293.66];

function getCachedDistortionCurve(amount) {
    const amt = Math.round(amount);
    if (!curveCache[amt]) {
        curveCache[amt] = makeDistortionCurve(amt);
    }
    return curveCache[amt];
}

function updateSynthesizer(micAmp) {
    if (!audioCtx) return;
    
    // 1. 各発振器の周波数と波形（音色）の更新
    for (let i = 0; i < 5; i++) {
        let freq = 
            CHORD_HAPPY[i] * smoothEmotion.happy +
            CHORD_SAD[i] * smoothEmotion.sad +
            CHORD_ANGRY[i] * smoothEmotion.angry +
            CHORD_SURPRISED[i] * smoothEmotion.surprised +
            CHORD_NEUTRAL[i] * smoothEmotion.neutral;
            
        // Happy: 喜びのオクターブアルペジオ・スイープ（120ms間隔で +12, +24半音）
        if (smoothEmotion.happy > 0.15) {
            let arpMult = 1.0;
            const step = Math.floor((Date.now() + i * 45) / 120) % 3; // 各発振器を少しずつズラしてカスケード
            if (step === 1) arpMult = 2.0;       // +12半音 (1オクターブ上)
            else if (step === 2) arpMult = 4.0;  // +24半音 (2オクターブ上)
            
            // 感情強度に応じてアルペジオ効果を100%までブレンド
            const targetMult = 1.0 + (arpMult - 1.0) * smoothEmotion.happy;
            freq *= targetMult;
        }
        
        // Angry: 怒りの高周波ランダムピッチジッター（悲鳴のようなエフェクト）
        let jitter = 0;
        if (smoothEmotion.angry > 0.15) {
            const jitterRange = 120 * smoothEmotion.angry; // 最大120Hz幅のジッター
            jitter = (Math.random() - 0.5) * jitterRange;
        }
            
        const waveMod = Math.sin(audioCtx.currentTime * 5) * (micAmp * 15);
        synthOscillators[i].frequency.setTargetAtTime(freq + waveMod + jitter, audioCtx.currentTime, 0.12);
        
        // 怒りの閾値で波形を動的に変化させて音色のキャラクターを強化 (Angryが高まると鋸歯状波/矩形波になり、さらに攻撃的に)
        const targetType = (smoothEmotion.angry > 0.3) 
            ? (i % 2 === 0 ? 'sawtooth' : 'square') 
            : (i % 2 === 0 ? 'sine' : 'triangle');
        if (synthOscillators[i].type !== targetType) {
            synthOscillators[i].type = targetType;
        }
        
        let volume = 0.15;
        if (smoothEmotion.angry > 0.3) volume += 0.08;
        
        // Sad: 静寂な深海フェードアウト（音量を極限まで下げる）
        if (smoothEmotion.sad > 0.1) {
            volume *= (1.0 - smoothEmotion.sad * 0.85); // 最大85%音量カット
        }
        
        const dynamicGain = volume * (0.3 + micAmp * 1.5);
        synthGains[i].gain.setTargetAtTime(dynamicGain, audioCtx.currentTime, 0.1);
    }
    
    // 2. ローパスフィルター周波数の動的制御（カットオフスイープ）
    // ハッピーは9500Hz、サプライズは8500Hzの超ブライト解放、悲しみは深海150Hzの超モゴモゴ、怒りは2500Hz
    const filterTarget = 
        9500 * smoothEmotion.happy +
        8500 * smoothEmotion.surprised +
        1500 * smoothEmotion.neutral +
        2500 * Math.max(0.1, 1 - smoothEmotion.sad) * smoothEmotion.angry +
        (150 * smoothEmotion.sad + 1500 * (1 - smoothEmotion.sad));
    audioFilter.frequency.setTargetAtTime(Math.max(100, Math.min(20000, filterTarget)), audioCtx.currentTime, 0.12);
    
    // 3. ディストーション量の動的アップデート
    if (audioDistortionNode) {
        // 怒りの最大時に350の過激なカーブを適用
        const distAmount = 120 + 230 * smoothEmotion.angry;
        audioDistortionNode.curve = getCachedDistortionCurve(distAmount);
    }

    // 4. 各エフェクトの音量バランスのクロスフェード
    
    // クリーン経路：怒りが高まるにつれて歪み経路に100%主役を譲るために完全にフェードアウト(0.5で完全カット)
    const cleanGainTarget = Math.max(0.0, 1.0 - smoothEmotion.angry * 2.0);
    audioCleanGain.gain.setTargetAtTime(cleanGainTarget, audioCtx.currentTime, 0.08);
    
    // ディストーション経路：怒り度に応じて爆音でフェードイン（ゲイン倍増）
    const distortionGainTarget = smoothEmotion.angry * 1.0 * (1.0 + micAmp * 2.0);
    audioDistortionGain.gain.setTargetAtTime(distortionGainTarget, audioCtx.currentTime, 0.08);
    
    // サプライズ用スラップバック・ディレイ経路
    const surpriseGainTarget = smoothEmotion.surprised * 0.75;
    audioDelayGainSurprised.gain.setTargetAtTime(surpriseGainTarget, audioCtx.currentTime, 0.1);
    
    // サプライズディレイ時間＆フィードバックの金属短縮（0.05s & 58%フィードバック）
    if (audioDelaySurprised) {
        const delayTimeTarget = 0.12 - (0.12 - 0.05) * smoothEmotion.surprised;
        audioDelaySurprised.delayTime.setTargetAtTime(delayTimeTarget, audioCtx.currentTime, 0.1);
    }
    if (audioFeedbackSurprised) {
        const feedbackTarget = 0.35 + (0.58 - 0.35) * smoothEmotion.surprised;
        audioFeedbackSurprised.gain.setTargetAtTime(feedbackTarget, audioCtx.currentTime, 0.1);
    }
    
    // 悲しみ用スペース・ディレイ経路
    const sadGainTarget = smoothEmotion.sad * 0.95;
    audioDelayGainSad.gain.setTargetAtTime(sadGainTarget, audioCtx.currentTime, 0.1);
    
    // 悲しみスペースディレイ・フィードバックゲインのダイナミック上昇（最大88%）
    if (audioFeedbackSad) {
        const feedbackSadTarget = 0.65 + (0.88 - 0.65) * smoothEmotion.sad;
        audioFeedbackSad.gain.setTargetAtTime(feedbackSadTarget, audioCtx.currentTime, 0.1);
    }
    
    // 5. ステレオパンナーの極限・超高速往復パン＆手の移動追従
    if (audioPanner) {
        // Surprised: 驚きのあまり15Hzで左右をめちゃくちゃに行き来するパンスイープ
        const panFreq = 15; // 15Hz
        const panSweep = Math.sin(Date.now() * 0.001 * 2 * Math.PI * panFreq) * 0.95 * smoothEmotion.surprised;
        
        // 手の左右差分に基づく緩やかなステレオ定位（手が左に行けば左、右に行けば右）
        const handDiff = (smoothRightHand.x - smoothLeftHand.x) / canvas.width; // 距離感
        const handPan = (smoothRightHand.alpha > 0.2 || smoothLeftHand.alpha > 0.2) 
            ? Math.max(-0.8, Math.min(0.8, handDiff * 1.5)) 
            : 0;
            
        // 驚いていない時は手の定位を優先、驚いた時は狂気的なパン往復
        let targetPan = panSweep + handPan * (1.0 - smoothEmotion.surprised);
        targetPan = Math.max(-1.0, Math.min(1.0, targetPan));
        
        audioPanner.pan.setTargetAtTime(targetPan, audioCtx.currentTime, 0.04);
    }
}


// === 7. ジェネレーティブ・アート (Particle System on Canvas) ===

class Particle {
    constructor(index) {
        this.index = index;
        this.reset(true);
    }
    
    reset(init = false) {
        this.x = Math.random() * canvas.width;
        this.y = init ? Math.random() * canvas.height : (canvas.height + 50);
        this.z = Math.random() * 200 - 100; // 3D奥行きを追加 (-100 〜 +100)
        
        // 極小サイズ
        this.size = Math.random() * 3.4 + 1.6; 
        this.speedX = Math.random() * 1 - 0.5;
        this.speedY = Math.random() * -1 - 0.2;
        this.speedZ = Math.random() * 1 - 0.5; // 3D奥行き移動速度
        this.alpha = Math.random() * 0.20 + 0.10; 
        this.color = { r: 255, g: 255, b: 255 };
        
        this.targetT = Math.random() * Math.PI * 2; 
        this.targetType = this.index % 7; 
        
        this.angle = Math.random() * Math.PI * 2;
        this.spinSpeed = Math.random() * 0.02 - 0.01;
        
        // 描画用の2D射影座標
        this.screenX = this.x;
        this.screenY = this.y;
        this.projectedScale = 1.0; // 奥行きによるスケール補正
        this.projectedAlpha = this.alpha; // 奥行きによるフェード補正

        // --- 3Dボリューム（厚み）のための永続パラメータ ---
        this.volTheta = Math.random() * Math.PI * 2; // 球体の経度
        this.volPhi = Math.acos((Math.random() * 2) - 1); // 球体の緯度（均一サンプリング用）
        this.volSide = Math.random() * Math.PI * 2; // 円柱の断面角度
        this.volRatio = Math.random(); // 骨格中心軸に沿った位置の割合 (0.0 〜 1.0)
        this.volRadius = 0.5 + Math.random() * 0.5; // 厚み（肉厚）方向の充填度 (0.5 〜 1.0)
    }
    
    update(micAmp) {
        // --- 感情ブレンドによる色彩制御 ---
        this.color.r = Math.round(
            255 * smoothEmotion.happy + 
            0 * smoothEmotion.sad + 
            255 * smoothEmotion.angry + 
            255 * smoothEmotion.surprised + 
            0 * smoothEmotion.neutral
        );
        this.color.g = Math.round(
            223 * smoothEmotion.happy + 
            112 * smoothEmotion.sad + 
            42 * smoothEmotion.angry + 
            0 * smoothEmotion.surprised + 
            255 * smoothEmotion.neutral
        );
        this.color.b = Math.round(
            0 * smoothEmotion.happy + 
            255 * smoothEmotion.sad + 
            42 * smoothEmotion.angry + 
            240 * smoothEmotion.surprised + 
            170 * smoothEmotion.neutral
        );
        
        let forceX = 0;
        let forceY = 0;
        let forceZ = 0;
        let tx = this.x;
        let ty = this.y;
        let tz = this.z;
        let isAttracted = false;
        
        // --- 全身仮想3D骨格モデルの計算（3Dボリューム化） ---
        if (true) {
            const headRadius = smoothFace.size * 0.44; 
            
            // 各部位 of 関節ノード（ジョイント）の定義
            const neckY = smoothFace.y + headRadius;
            const shoulderY = smoothFace.y + smoothFace.size * 0.55;
            const leftShoulderX = smoothFace.x - smoothFace.size * 0.75;
            const rightShoulderX = smoothFace.x + smoothFace.size * 0.75;
            const hipsY = smoothFace.y + smoothFace.size * 2.2; // 腰の位置
            
            if (this.targetType === 0) {
                // 1. 頭部（円から完璧な3D球体シェルへ。さらにふくよかな球体に厚みを増加）
                const r = headRadius * (1.20 + 0.45 * this.volRadius);
                tx = smoothFace.x + Math.sin(this.volPhi) * Math.cos(this.volTheta) * r;
                ty = smoothFace.y + Math.cos(this.volPhi) * r;
                tz = Math.sin(this.volPhi) * Math.sin(this.volTheta) * r;
                isAttracted = true;
            } else if (this.targetType === 1) {
                // 2. 肩と首のライン（厚みつき3Dシリンダー。さらに肉厚に）
                const t = (this.volRatio * 2.0) - 1.0; // -1.0 〜 1.0 の肩幅位置
                const shoulderWidth = smoothFace.size * 1.6; 
                let baseTx = smoothFace.x + t * shoulderWidth;
                
                const shoulderDrop = (1.0 - Math.cos(t * Math.PI)) * smoothFace.size * 0.42;
                let baseTy = shoulderY + shoulderDrop;
                
                // 首の引き上げ
                if (Math.abs(t) < 0.18) {
                    const neckBlend = (0.18 - Math.abs(t)) / 0.18;
                    baseTy = baseTy * (1.0 - neckBlend) + neckY * neckBlend;
                }
                let baseTz = -Math.sin(Math.abs(t) * Math.PI) * smoothFace.size * 0.15; // 肩の緩やかな3D前後カーブ
                
                // 厚みの追加：首のあたりは太く、肩の先端に向けてスリムに（厚みをさらにブースト）
                const neckFactor = Math.abs(t) < 0.18 ? 1.35 : 1.0;
                const thickR = smoothFace.size * 0.33 * (1.0 - Math.abs(t) * 0.30) * neckFactor * (0.80 + 0.40 * this.volRadius);
                
                // 3D円柱状に粒子を散布（前後左右）
                tx = baseTx + Math.cos(this.volSide) * thickR;
                ty = baseTy + Math.sin(this.volSide) * thickR * 0.35; // 縦（上下）方向は少し絞る
                tz = baseTz + Math.sin(this.volSide) * thickR;
                isAttracted = true;
            } else if (this.targetType === 2) {
                // 3. 【左腕全体（3Dテーパーシリンダー）】左肩から左手まで
                const pStart = { x: leftShoulderX, y: shoulderY, z: -smoothFace.size * 0.05 };
                const handZ = smoothLeftHand.active ? (Math.sin(Date.now() * 0.004) * smoothFace.size * 0.6) : (smoothFace.size * 0.1);
                const pEnd = { x: smoothLeftHand.x, y: smoothLeftHand.y, z: handZ };
                
                // 軸に沿った補間点
                const baseTx = pStart.x + (pEnd.x - pStart.x) * this.volRatio;
                const baseTy = pStart.y + (pEnd.y - pStart.y) * this.volRatio;
                const baseTz = pStart.z + (pEnd.z - pStart.z) * this.volRatio;
                
                // 軸方向の法線ベクトル算出
                const dx = pEnd.x - pStart.x;
                const dy = pEnd.y - pStart.y;
                const dz = pEnd.z - pStart.z;
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
                const udx = dx / len;
                const udy = dy / len;
                const udz = dz / len;
                
                let vx = 0, vy = 1, vz = 0;
                if (Math.abs(udx) > 0.9) {
                    vx = 0; vy = 0; vz = 1;
                }
                let n1x = udy * vz - udz * vy;
                let n1y = udz * vx - udx * vz;
                let n1z = udx * vy - udy * vx;
                const n1Len = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z) || 1;
                n1x /= n1Len; n1y /= n1Len; n1z /= n1Len;
                
                const n2x = udy * n1z - udz * n1y;
                const n2y = udz * n1x - udx * n1z;
                const n2z = udx * n1y - udy * n1x;
                
                // 肩から手首に向けて細くなるテーパー半径（太さを大幅にアップ）
                const armRadius = smoothFace.size * (0.34 * (1.0 - 0.40 * this.volRatio)) * (0.80 + 0.40 * this.volRadius);
                
                tx = baseTx + (Math.cos(this.volSide) * n1x + Math.sin(this.volSide) * n2x) * armRadius;
                ty = baseTy + (Math.cos(this.volSide) * n1y + Math.sin(this.volSide) * n2y) * armRadius;
                tz = baseTz + (Math.cos(this.volSide) * n1z + Math.sin(this.volSide) * n2z) * armRadius;
                isAttracted = true;
            } else if (this.targetType === 3) {
                // 4. 【右腕全体（3Dテーパーシリンダー）】右肩から右手まで
                const pStart = { x: rightShoulderX, y: shoulderY, z: -smoothFace.size * 0.05 };
                const handZ = smoothRightHand.active ? (Math.cos(Date.now() * 0.004) * smoothFace.size * 0.6) : (smoothFace.size * -0.1);
                const pEnd = { x: smoothRightHand.x, y: smoothRightHand.y, z: handZ };
                
                const baseTx = pStart.x + (pEnd.x - pStart.x) * this.volRatio;
                const baseTy = pStart.y + (pEnd.y - pStart.y) * this.volRatio;
                const baseTz = pStart.z + (pEnd.z - pStart.z) * this.volRatio;
                
                const dx = pEnd.x - pStart.x;
                const dy = pEnd.y - pStart.y;
                const dz = pEnd.z - pStart.z;
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
                const udx = dx / len;
                const udy = dy / len;
                const udz = dz / len;
                
                let vx = 0, vy = 1, vz = 0;
                if (Math.abs(udx) > 0.9) {
                    vx = 0; vy = 0; vz = 1;
                }
                let n1x = udy * vz - udz * vy;
                let n1y = udz * vx - udx * vz;
                let n1z = udx * vy - udy * vx;
                const n1Len = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z) || 1;
                n1x /= n1Len; n1y /= n1Len; n1z /= n1Len;
                
                const n2x = udy * n1z - udz * n1y;
                const n2y = udz * n1x - udx * n1z;
                const n2z = udx * n1y - udy * n1x;
                
                // 肩から手首に向けて細くなるテーパー半径（太さを大幅にアップ）
                const armRadius = smoothFace.size * (0.34 * (1.0 - 0.40 * this.volRatio)) * (0.80 + 0.40 * this.volRadius);
                
                tx = baseTx + (Math.cos(this.volSide) * n1x + Math.sin(this.volSide) * n2x) * armRadius;
                ty = baseTy + (Math.cos(this.volSide) * n1y + Math.sin(this.volSide) * n2y) * armRadius;
                tz = baseTz + (Math.cos(this.volSide) * n1z + Math.sin(this.volSide) * n2z) * armRadius;
                isAttracted = true;
            } else if (this.targetType === 4) {
                // 5. 【胴体（3D楕円柱・ふくよかな体幹。厚みをさらに2倍近く増加）】
                const u = this.volRatio;
                const baseTx = smoothFace.x + Math.sin(u * Math.PI * 2) * smoothFace.size * 0.08; 
                const baseTy = neckY + u * (hipsY - neckY);
                const baseTz = Math.cos(u * Math.PI) * smoothFace.size * 0.12;
                
                // お腹の真ん中で太く、首や腰で少し絞る楕円の半径（3D肉厚化）
                const rx = smoothFace.size * 0.78 * (0.85 + 0.35 * Math.sin(u * Math.PI)) * (0.80 + 0.40 * this.volRadius); // 左右幅を肉厚化
                const rz = smoothFace.size * 0.75 * (0.80 + 0.30 * Math.sin(u * Math.PI)) * (0.80 + 0.40 * this.volRadius); // 前後厚み（z方向）を劇的に増強して完璧な3D肉感に！
                
                tx = baseTx + Math.cos(this.volSide) * rx;
                ty = baseTy;
                tz = baseTz + Math.sin(this.volSide) * rz;
                isAttracted = true;
            } else if (this.targetType === 5) {
                // 6. 【脚部（3Dテーパーシリンダー）】
                const isLeftLeg = (this.index % 2 === 0);
                const legOffset = smoothFace.size * 0.18 * (isLeftLeg ? -1 : 1);
                const footSpread = this.volRatio * smoothFace.size * 0.12 * (isLeftLeg ? -1 : 1);
                const legLength = smoothFace.size * 2.8;

                const pStart = { x: smoothFace.x + legOffset, y: hipsY, z: 0 };
                const pEnd = { x: smoothFace.x + legOffset + footSpread, y: hipsY + legLength, z: (isLeftLeg ? 1 : -1) * Math.sin(this.volRatio * Math.PI) * smoothFace.size * 0.05 };

                const baseTx = pStart.x + (pEnd.x - pStart.x) * this.volRatio;
                const baseTy = pStart.y + (pEnd.y - pStart.y) * this.volRatio;
                const baseTz = pStart.z + (pEnd.z - pStart.z) * this.volRatio;

                const dx = pEnd.x - pStart.x;
                const dy = pEnd.y - pStart.y;
                const dz = pEnd.z - pStart.z;
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
                const udx = dx / len;
                const udy = dy / len;
                const udz = dz / len;

                let vx = 0, vy = 1, vz = 0;
                if (Math.abs(udx) > 0.9) { vx = 0; vy = 0; vz = 1; }
                let n1x = udy * vz - udz * vy;
                let n1y = udz * vx - udx * vz;
                let n1z = udx * vy - udy * vx;
                const n1Len = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z) || 1;
                n1x /= n1Len; n1y /= n1Len; n1z /= n1Len;

                const n2x = udy * n1z - udz * n1y;
                const n2y = udz * n1x - udx * n1z;
                const n2z = udx * n1y - udy * n1x;

                // 太ももから足首に向けて絞られるテーパー半径（太さをアップ）
                const legRadius = smoothFace.size * (0.44 * (1.0 - 0.35 * this.volRatio)) * (0.80 + 0.40 * this.volRadius);

                tx = baseTx + (Math.cos(this.volSide) * n1x + Math.sin(this.volSide) * n2x) * legRadius;
                ty = baseTy + (Math.cos(this.volSide) * n1y + Math.sin(this.volSide) * n2y) * legRadius;
                tz = baseTz + (Math.cos(this.volSide) * n1z + Math.sin(this.volSide) * n2z) * legRadius;
                isAttracted = true;
                this.alpha = Math.max(0.04, this.alpha * (1.0 - this.volRatio * 0.4));
            }
        }
        
        // --- 3D引き寄せ物理演算の適用 ---
        if (isAttracted) {
            const driftSpeed = Date.now() * 0.0014 + this.index;
            const driftRadius = smoothFace.size * 0.14; 
            
            tx += Math.cos(driftSpeed) * driftRadius;
            ty += Math.sin(driftSpeed * 0.75) * driftRadius;
            tz += Math.sin(driftSpeed * 1.3) * driftRadius;
            
            // アクティブに追従している時は、手をあげる動作のタイムラグや残像（デフォルト手が並存する不具合）を無くすため、吸引力を12倍（0.24）に超ブースト！
            // 非アクティブ（デフォルト手への復帰）の時も、元の位置に素早くスナップバックさせるために 0.08 にアップ！
            let attractionStrength = 0.020;
            if (this.targetType === 2) {
                attractionStrength = smoothLeftHand.active ? 0.24 : 0.08; 
            } else if (this.targetType === 3) {
                attractionStrength = smoothRightHand.active ? 0.24 : 0.08;
            } else {
                if (smoothEmotion.sad > 0.1) attractionStrength = 0.010; 
                if (smoothEmotion.angry > 0.1) attractionStrength = 0.038;  
            }
            
            const scatter = micAmp * 35 * (Math.random() - 0.5);
            
            const dx = (tx + scatter) - this.x;
            const dy = (ty + scatter) - this.y;
            const dz = (tz + scatter) - this.z;
            
            forceX += dx * attractionStrength;
            forceY += dy * attractionStrength;
            forceZ += dz * attractionStrength;
            
            this.speedX *= 0.92;
            this.speedY *= 0.92;
            this.speedZ *= 0.92;
            
            if ((this.targetType === 2 && smoothLeftHand.active) || (this.targetType === 3 && smoothRightHand.active)) {
                this.alpha = Math.min(0.55, this.alpha + 0.01);
            }
        } else {
            if (smoothEmotion.happy > 0.1) {
                this.angle += this.spinSpeed;
                forceX += Math.sin(this.angle) * 0.6 * smoothEmotion.happy;
                forceZ += Math.cos(this.angle) * 0.6 * smoothEmotion.happy;
                forceY -= 0.6 * smoothEmotion.happy;
            }
            if (smoothEmotion.sad > 0.1) {
                forceY += 1.2 * smoothEmotion.sad;
                forceX *= 0.8; forceZ *= 0.8;
            }
            if (smoothEmotion.angry > 0.1) {
                forceX += (Math.random() * 4 - 2) * smoothEmotion.angry;
                forceY += (Math.random() * 4 - 2) * smoothEmotion.angry;
                forceZ += (Math.random() * 4 - 2) * smoothEmotion.angry;
            }
            if (smoothEmotion.surprised > 0.1) {
                const dx = this.x - canvas.width / 2;
                const dy = this.y - canvas.height / 2;
                const dz = this.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > 0) {
                    forceX += (dx / dist) * 1.8 * smoothEmotion.surprised;
                    forceY += (dy / dist) * 1.8 * smoothEmotion.surprised;
                    forceZ += (dz / dist) * 1.8 * smoothEmotion.surprised;
                }
            }
            if (smoothEmotion.neutral > 0.1) {
                forceX += 0.4 * smoothEmotion.neutral;
                forceY -= 0.1 * smoothEmotion.neutral;
                forceZ += 0.1 * smoothEmotion.neutral;
            }
            this.speedX *= 0.98; this.speedY *= 0.98; this.speedZ *= 0.98;
        }
        
        this.x += (this.speedX + forceX) * (1.0 + micAmp);
        this.y += (this.speedY + forceY) * (1.0 + micAmp);
        this.z += (this.speedZ + forceZ) * (1.0 + micAmp);
        
        if (this.x < -150 || this.x > canvas.width + 150 || this.y < -150 || this.y > canvas.height + 150 || this.z < -250 || this.z > 250) {
            this.reset();
        }
        
        const centerX = smoothFace.x;
        const centerY = smoothFace.y + smoothFace.size * 1.4;
        let rx = this.x - centerX, ry = this.y - centerY, rz = this.z;
        let x1 = rx * Math.cos(renderAngleY) - rz * Math.sin(renderAngleY);
        let z1 = rx * Math.sin(renderAngleY) + rz * Math.cos(renderAngleY);
        let y2 = ry * Math.cos(angleX) - z1 * Math.sin(angleX);
        let z2 = ry * Math.sin(angleX) + z1 * Math.cos(angleX);
        
        const cameraDistance = 450; // カメラ距離
        
        // 奥の粒子を小さく、手前を大きくするための投影スケール (ズームを反映)
        const projScale = (fov * finalZoom) / (cameraDistance + z2);
        
        // スクリーン座標に再マッピング
        this.screenX = centerX + x1 * projScale;
        this.screenY = centerY + y2 * projScale;
        this.projectedScale = projScale;
        
        // 奥行きに基づく不透明度とサイズ補正（手前は明るく大きく、奥は薄く小さく＝被写界深度エフェクト）
        this.projectedAlpha = Math.max(0.02, Math.min(0.85, this.alpha * (projScale * 0.95)));
        
        const ampScale = 1.0 + micAmp * 3.5;
        const finalSize = this.size * projScale * 0.65 * ampScale; // 3D透視サイズ
        
        // 描画
        ctx.beginPath();
        ctx.arc(this.screenX, this.screenY, finalSize, 0, Math.PI * 2);
        
        // 発光エフェクト（Glow）
        const glowStr = Math.round(9 * (smoothEmotion.happy + smoothEmotion.angry + smoothEmotion.surprised) * projScale);
        ctx.shadowBlur = glowStr;
        ctx.shadowColor = `rgb(${this.color.r}, ${this.color.g}, ${this.color.b})`;
        
        ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${this.projectedAlpha})`;
        ctx.fill();
        
        ctx.shadowBlur = 0; 
    }
}

// パーティクルシステムの初期化
function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new Particle(i));
    }
}
initParticles();


// === 7.5. バースト・パーティクル・システム (Burst Particles) ===

// 爆発・オーラ用パーティクルを格納するグローバル配列
let burstParticles = [];
let lastBeatBurstTime = 0;
let prevEmotion = { happy: 0, sad: 0, angry: 0, surprised: 0, neutral: 0 };

// 左右の手の速度追跡用
let prevLeftHand = { x: 0, y: 0 };
let prevRightHand = { x: 0, y: 0 };

// 手が素早く動いた際の、移動方向（ベクトル）に吹き飛ぶ軌跡バースト
function spawnMotionBurst(x, y, dx, dy, speed) {
    const particleCount = Math.min(8, Math.max(3, Math.round(speed * 0.45)));
    
    // 現在の主要な感情に対応する色彩（通常は白銀きらきら、怒り時は赤など）
    let color = { r: 245, g: 245, b: 250 };
    let type = 'vocal';
    
    if (smoothEmotion.happy > 0.2) {
        color = { r: 255, g: 223, b: 0 }; type = 'happy';
    } else if (smoothEmotion.sad > 0.2) {
        color = { r: 52, g: 152, b: 219 }; type = 'sad';
    } else if (smoothEmotion.angry > 0.2) {
        color = { r: 231, g: 76, b: 60 }; type = 'angry';
    } else if (smoothEmotion.surprised > 0.2) {
        color = { r: 0, g: 255, b: 220 }; type = 'surprised';
    }
    
    for (let i = 0; i < particleCount; i++) {
        if (burstParticles.length < 650) {
            const bp = new BurstParticle(x, y, 0, color, type, false);
            bp.decay = Math.random() * 0.045 + 0.025; // 軌跡なので少し早く消えてシャープにする
            bp.size = Math.random() * 2.8 + 1.2;
            
            // 手の進行ベクトル（dx, dy）の勢いを乗せる (スケーリングしつつランダムな拡散を与える)
            const spread = 2.4;
            bp.vx = dx * 0.42 + (Math.random() - 0.5) * spread;
            bp.vy = dy * 0.42 + (Math.random() - 0.5) * spread;
            bp.vz = (Math.random() - 0.5) * spread;
            
            burstParticles.push(bp);
        }
    }
}

function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    let c = (1 - Math.abs(2 * l - 1)) * s;
    let x = c * (1 - Math.abs((h / 60) % 2 - 1));
    let m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) {
        r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
        r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
        r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
        r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
        r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
        r = c; g = 0; b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

class BurstParticle {
    constructor(x, y, z, color, type, isHeavy = false) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.color = { ...color };
        this.type = type; // 'vocal', 'happy', 'sad', 'angry', 'surprised'
        this.life = 1.0;
        
        // 通常のオーラは長生き、爆発バーストは早く消える
        this.decay = isHeavy ? (Math.random() * 0.03 + 0.02) : (Math.random() * 0.015 + 0.01);
        this.size = Math.random() * 3.5 + 1.2;
        
        // 初速度 (3D方向への爆発的な広がり)
        const speed = isHeavy ? (Math.random() * 6.5 + 3.5) : (Math.random() * 1.8 + 0.6);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        
        this.vx = Math.sin(phi) * Math.cos(theta) * speed;
        this.vy = Math.cos(phi) * speed;
        this.vz = Math.sin(phi) * Math.sin(theta) * speed;
        
        // 感情ごとの特殊な力 (重力や浮力、空気抵抗)
        this.gravity = 0;
        this.drag = 0.94; // プレミアムな空気抵抗・減衰効果
        
        if (type === 'sad') {
            this.gravity = 0.07; // 悲しみの涙は下へ落ちる
        } else if (type === 'happy') {
            this.gravity = -0.05; // 喜びのバブルは上へ浮かぶ
        } else if (type === 'angry') {
            this.gravity = -0.02; // 怒りの火花は熱気で少し上に立ち上る
            this.drag = 0.96;     // 勢いよく広がり続ける
        }
    }
    
    update(micAmp) {
        this.vx *= this.drag;
        this.vy *= this.drag;
        this.vz *= this.drag;
        
        this.vy += this.gravity;
        
        this.x += this.vx;
        this.y += this.vy;
        this.z += this.vz;
        
        this.life -= this.decay;
        
        // 3Dアングル、たゆたい、ズームを考慮してメインカメラに射影
        const centerX = smoothFace.x;
        const centerY = smoothFace.y + smoothFace.size * 1.4;
        let rx = this.x - centerX, ry = this.y - centerY, rz = this.z;
        let x1 = rx * Math.cos(renderAngleY) - rz * Math.sin(renderAngleY);
        let z1 = rx * Math.sin(renderAngleY) + rz * Math.cos(renderAngleY);
        let y2 = ry * Math.cos(angleX) - z1 * Math.sin(angleX);
        let z2 = ry * Math.sin(angleX) + z1 * Math.cos(angleX);
        
        const cameraDistance = 450;
        const projScale = (fov * finalZoom) / (cameraDistance + z2);
        
        const screenX = centerX + x1 * projScale;
        const screenY = centerY + y2 * projScale;
        const finalSize = this.size * projScale * this.life;
        const alpha = Math.max(0, Math.min(0.9, this.life * projScale));
        
        if (alpha > 0 && screenX > -50 && screenX < canvas.width + 50 && screenY > -50 && screenY < canvas.height + 50) {
            ctx.beginPath();
            ctx.arc(screenX, screenY, finalSize, 0, Math.PI * 2);
            
            // 感情やビートに応じた発光エフェクト (Glow)
            let shadowBlur = 0;
            if (this.type === 'angry' || this.type === 'happy' || this.type === 'surprised' || this.type === 'vocal') {
                shadowBlur = Math.round(9 * this.life * projScale);
            }
            ctx.shadowBlur = shadowBlur;
            ctx.shadowColor = `rgb(${this.color.r}, ${this.color.g}, ${this.color.b})`;
            
            ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha})`;
            ctx.fill();
            
            ctx.shadowBlur = 0;
        }
    }
}

// アクティブな関節座標から粒子を一斉に弾けさせる
function spawnBurstAtBodyParts(type, count) {
    let color = { r: 255, g: 255, b: 255 };
    if (type === 'happy') color = { r: 255, g: 215, b: 0 }; // 黄金
    else if (type === 'sad') color = { r: 52, g: 152, b: 219 };  // 涙のブルー
    else if (type === 'angry') color = { r: 231, g: 76, b: 60 };  // 怒りの真紅
    else if (type === 'surprised') color = { r: 0, g: 255, b: 220 }; // シアン
    else if (type === 'vocal') color = { r: 245, g: 245, b: 250 }; // 白銀
    
    const parts = [];
    parts.push({ x: smoothFace.x, y: smoothFace.y, z: 0 }); // 頭部
    
    // 両手がアクティブ（または表示中）なら放出ポイントに含める
    if (smoothLeftHand.alpha > 0.2) {
        parts.push({ x: smoothLeftHand.x, y: smoothLeftHand.y, z: 0 });
    }
    if (smoothRightHand.alpha > 0.2) {
        parts.push({ x: smoothRightHand.x, y: smoothRightHand.y, z: 0 });
    }
    
    const perPartCount = Math.ceil(count / parts.length);
    for (const part of parts) {
        for (let i = 0; i < perPartCount; i++) {
            if (burstParticles.length < 650) {
                const ox = part.x + (Math.random() * 20 - 10);
                const oy = part.y + (Math.random() * 20 - 10);
                const oz = part.z + (Math.random() * 20 - 10);
                burstParticles.push(new BurstParticle(ox, oy, oz, color, type, true));
            }
        }
    }
}

// 骨格上の関節ノード（頭、両手、肩、胴体）からランダムな3Dポイントを取得（オーラ用）
function getRandomSkeletonPoint() {
    const randType = Math.floor(Math.random() * 5);
    const headRadius = smoothFace.size * 0.44;
    const shoulderY = smoothFace.y + smoothFace.size * 0.55;
    const hipsY = smoothFace.y + smoothFace.size * 2.2;
    
    if (randType === 0) { // 頭
        return {
            x: smoothFace.x + (Math.random() - 0.5) * headRadius,
            y: smoothFace.y + (Math.random() - 0.5) * headRadius,
            z: (Math.random() - 0.5) * headRadius
        };
    } else if (randType === 1 && smoothLeftHand.alpha > 0.2) { // 左手
        return { x: smoothLeftHand.x, y: smoothLeftHand.y, z: 0 };
    } else if (randType === 2 && smoothRightHand.alpha > 0.2) { // 右手
        return { x: smoothRightHand.x, y: smoothRightHand.y, z: 0 };
    } else if (randType === 3) { // 胴体
        const u = Math.random();
        return {
            x: smoothFace.x + (Math.random() - 0.5) * smoothFace.size * 0.4,
            y: shoulderY + u * (hipsY - shoulderY),
            z: (Math.random() - 0.5) * smoothFace.size * 0.2
        };
    } else { // 左右の肩
        const isLeft = Math.random() < 0.5;
        const sx = smoothFace.x + (isLeft ? -1 : 1) * smoothFace.size * 0.75;
        return { x: sx, y: shoulderY, z: 0 };
    }
}


// === 8. アニメーション ＆ メインループ ===
function animate() {
    if (!isStarted) return;
    requestAnimationFrame(animate);
    
    // --- 1. マイク解析 (音声データの取得) をループ冒頭へ移動し、全身のアニメーション・ダンスとシンクロさせる ---
    let micAmp = 0;
    if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
            
            const barHeight = (dataArray[i] / 255) * 100;
            const bar = audioWaveBars.children[i % 16];
            if (bar) {
                bar.style.height = `${Math.max(10, barHeight)}%`;
                bar.style.backgroundColor = `rgb(${particles[0]?.color.r || 0}, ${particles[0]?.color.g || 255}, ${particles[0]?.color.b || 170})`;
            }
        }
        const avg = sum / dataArray.length;
        const sens = parseFloat(micSensitivity.value);
        micAmp = (avg / 255) * (sens / 5);
        micAmp = Math.min(1.0, micAmp);
    }
    
    // --- 1.5. 音声連動バースト (Vocal Beat Burst) の判定 ＆ トリガー ---
    if (micAmp > 0.42 && Date.now() - lastBeatBurstTime > 150) {
        spawnBurstAtBodyParts('vocal', 22);
        lastBeatBurstTime = Date.now();
    }
    
    // --- 2. ユーザーおよび映画的シネマティックカメラズーム (アップ・引き) の計算 ---
    userZoom += (targetUserZoom - userZoom) * 0.08;
    
    const zoomTime = Date.now() * 0.001;
    let cinematicZoom = 1.0;
    
    if (smoothEmotion.neutral > 0.1) {
        // Neutral: ゆったりとした極上の映画的呼吸（15秒周期でのなめらかなズームイン・アウト）
        cinematicZoom += Math.sin(zoomTime * 0.3) * 0.12 * smoothEmotion.neutral;
    }
    if (smoothEmotion.happy > 0.1) {
        // Happy: 喜びを爆発させつつ、腕の羽ばたきを広く見せるために少し引きつつ、ビートパルスを加える
        cinematicZoom += (Math.sin(zoomTime * 2.8) * 0.08 - 0.04) * smoothEmotion.happy;
    }
    if (smoothEmotion.sad > 0.1) {
        // Sad: 哀愁と静けさを引き出す、ゆっくりとした劇的なズームイン（インティメイト・クローズアップ）
        cinematicZoom += 0.32 * smoothEmotion.sad + Math.sin(zoomTime * 0.4) * 0.05 * smoothEmotion.sad;
    }
    if (smoothEmotion.angry > 0.1) {
        // Angry: 怒りのプレッシャーを高める緊迫の寄り（中密着ズーム ＋ 激しいピクセルの脈動）
        cinematicZoom += 0.22 * smoothEmotion.angry + (Math.random() - 0.5) * 0.02 * smoothEmotion.angry;
    }
    if (smoothEmotion.surprised > 0.1) {
        // Surprised: ドキッとした衝撃でカメラをパッと後ろに引き（一時的急激な引き）、ダイナミックな全身像を見せる
        cinematicZoom -= 0.30 * smoothEmotion.surprised;
    }
    
    // 音量（声のビート）を検知した際のダイナミックな肉動パルスズーム
    if (micAmp > 0.05) {
        cinematicZoom += micAmp * 0.15;
    }
    
    // 合成された最終カメラズームをグローバルに適用
    finalZoom = userZoom * cinematicZoom;

    // --- 3. 3Dアングル（カメラ回転・たゆたい）の感情駆動型更新 ---
    let baseSpin = 0.0055;      // 標準の自転速度 (Neutral)
    let swayAmp = 0.06;        // 標準のたゆたい（スウェイ）振幅
    let swayFreq = 0.00035;     // 標準のたゆたい周波数

    if (smoothEmotion.happy > 0.1) {
        baseSpin += 0.015 * smoothEmotion.happy;
        swayAmp += 0.04 * smoothEmotion.happy;
        swayFreq *= (1.0 + 0.5 * smoothEmotion.happy);
    }
    if (smoothEmotion.sad > 0.1) {
        baseSpin *= (1.0 - 0.9 * smoothEmotion.sad);
        swayAmp *= (1.0 - 0.8 * smoothEmotion.sad);
        swayFreq *= (1.0 - 0.6 * smoothEmotion.sad);
    }
    if (smoothEmotion.angry > 0.1) {
        baseSpin += (Math.random() - 0.5) * 0.01 * smoothEmotion.angry;
        swayAmp += (Math.random() - 0.5) * 0.02 * smoothEmotion.angry;
        swayFreq *= (1.0 + 2.5 * smoothEmotion.angry);
    }
    if (smoothEmotion.surprised > 0.1) {
        baseSpin += 0.03 * smoothEmotion.surprised;
        swayAmp += 0.08 * smoothEmotion.surprised;
        swayFreq *= (1.0 + 4.0 * smoothEmotion.surprised);
    }

    // マウスドラッグ回転角度を慣性を乗せて滑らかに補間
    mouseAngleY += (targetMouseAngleY - mouseAngleY) * 0.08;
    mouseAngleX += (targetMouseAngleX - mouseAngleX) * 0.08;

    angleY += baseSpin; // 感情連動した自転速度で回転
    renderAngleY = angleY + mouseAngleY; // 自転 ＋ マウスドラッグ量
    
    // たゆたい角度 angleX の算出
    let targetAngleX = 0.12 + Math.sin(Date.now() * swayFreq) * swayAmp;
    
    // 感情ごとの特殊な angleX 変調
    if (smoothEmotion.sad > 0.1) {
        // Sad: 少し前にうなだれる
        targetAngleX += 0.08 * smoothEmotion.sad;
    }
    if (smoothEmotion.surprised > 0.1) {
        // Surprised: のけぞる
        targetAngleX -= 0.15 * smoothEmotion.surprised;
    }
    if (smoothEmotion.angry > 0.1) {
        // Angry: 怒りの微細な震え
        targetAngleX += (Math.random() - 0.5) * 0.015 * smoothEmotion.angry;
    }

    // 最終角度（たゆたい・感情変調 ＋ マウスドラッグ量）
    angleX = targetAngleX + mouseAngleX;
    
    // ジェスチャー（差分モーション）を検出
    detectMotion();
    
    // 残像（トレイル）によるブレンド。引きになった星屑がより幽玄に溶け合うよう調整
    const fadeAlpha = 0.035 + 0.08 * smoothEmotion.angry - 0.015 * smoothEmotion.sad;
    ctx.fillStyle = `rgba(5, 4, 9, ${Math.max(0.01, Math.min(0.14, fadeAlpha))})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // --- 8a. 感情データの Lerp（なめらかな補間） ---
    for (const key of Object.keys(emotionData)) {
        // 怒り（angry）は表情とシンクロした爆速の反応性を引き出すため、補間速度を3.5倍（0.28）に設定
        const factor = (key === 'angry') ? Math.min(0.28, LERP_FACTOR * 3.5) : LERP_FACTOR;
        smoothEmotion[key] += (emotionData[key] - smoothEmotion[key]) * factor;
    }
    
    // --- 8a.5. 感情遷移バースト (Transition Burst) ＆ 継続的オーラ (Ambient Flares) の処理 ---
    for (const key of Object.keys(smoothEmotion)) {
        const diff = smoothEmotion[key] - prevEmotion[key];
        if (diff > 0.12) {
            // 感情が急上昇した瞬間にバースト爆発をトリガー
            spawnBurstAtBodyParts(key, 38);
        }
        prevEmotion[key] = smoothEmotion[key]; // 前フレーム値の更新
        
        // 感情の強さに応じた継続的オーラ (Ambient Flares)
        const val = smoothEmotion[key];
        if (key !== 'neutral' && val > 0.22) {
            // 感情値が高いほど、高確率で体からオーラ粒子が立ち上る
            if (Math.random() < val * 0.28) {
                const part = getRandomSkeletonPoint();
                let auraColor = { r: 255, g: 255, b: 255 };
                if (key === 'happy') auraColor = { r: 255, g: 215, b: 0 }; // 黄金気泡
                else if (key === 'sad') auraColor = { r: 100, g: 180, b: 255 }; // 涙の青い粒子
                else if (key === 'angry') auraColor = { r: 255, g: 80, b: 20 }; // 赤熱する火花
                else if (key === 'surprised') auraColor = { r: 0, g: 255, b: 210 }; // シアンパルス
                
                if (burstParticles.length < 650) {
                    const bp = new BurstParticle(part.x, part.y, part.z, auraColor, key, false);
                    bp.decay = Math.random() * 0.012 + 0.008; // オーラは爆発より長生き
                    bp.size = Math.random() * 2.2 + 0.8;
                    burstParticles.push(bp);
                }
            }
        }
    }
    
    // --- 8b. 顔位置データの Lerp（なめらかな追従） ---
    if (faceTarget.active) {
        smoothFace.x += (faceTarget.x - smoothFace.x) * 0.12;
        smoothFace.y += (faceTarget.y - smoothFace.y) * 0.12;
        smoothFace.size += (faceTarget.size - smoothFace.size) * 0.12;
    } else {
        // 顔が検出されていないときは、マイク音量と感情を高度にブレンドした自律ダンスを躍動的に踊る
        const driftTime = Date.now() * 0.0008;
        
        // 標準的なコズミック・ワルツ（優美な ∞ フィギュア8 軌道のダンスパス）
        const defX = canvas.width / 2 + Math.sin(driftTime) * 45 + Math.sin(driftTime * 2.0) * 15;
        let defY = canvas.height * 0.20 + Math.cos(driftTime * 1.3) * 22 + Math.cos(driftTime * 0.7) * 12; // 中央上寄りに最適化
        let defSize = 145 + Math.sin(driftTime * 1.5) * 5.0; // 奥行きの微細な呼吸リズム
        
        // 音声（ビート）入力によるダイナミックな縦バウンド（音量で大きくジャンプ・収縮！）
        if (micAmp > 0.05) {
            defY -= micAmp * 120; // 大きくなった体に合わせてジャンプ幅を倍増！
            defSize += micAmp * 15; // 奥行き脈動も倍増
        }
        
        // 感情による顔位置（身体全体）の自律的なダンス・ポージング変調
        const time = Date.now() * 0.002;
        
        if (smoothEmotion.happy > 0.15) {
            // Happy: 喜びで跳ね踊る、さらに軽快な3D旋回の螺旋ステップ
            defY += Math.sin(time * 2.8) * 35 * smoothEmotion.happy;
            defY += Math.cos(time * 4.0) * 15 * smoothEmotion.happy;
        }
        if (smoothEmotion.sad > 0.15) {
            // Sad: 力なくうなだれ、ゆっくりと深く沈み込む（ため息と重力）
            defY += 45 * smoothEmotion.sad + Math.sin(time * 0.3) * 10 * smoothEmotion.sad;
        }
        if (smoothEmotion.angry > 0.15) {
            // Angry: 怒りの微細な高周波シェイク
            defY += (Math.random() - 0.5) * 15 * smoothEmotion.angry;
        }
        if (smoothEmotion.surprised > 0.15) {
            // Surprised: ドキッとした驚きで大きく宙へ跳ね上がり、一時的に拡大
            defY -= 65 * smoothEmotion.surprised;
            defSize += 35 * smoothEmotion.surprised;
        }
        if (smoothEmotion.neutral > 0.15) {
            // Neutral: 穏やかな呼吸リズム
            defY += Math.sin(time * 0.6) * 10 * smoothEmotion.neutral;
        }

        smoothFace.x += (defX - smoothFace.x) * 0.022; // ダンスが映えるよう、追従レスポンスを微増
        smoothFace.y += (defY - smoothFace.y) * 0.022;
        smoothFace.size += (defSize - smoothFace.size) * 0.022;
    }
    
    // --- 8c. 【全身トレース】手の位置（ジェスチャー重心）の Lerp ＆ 立ち姿デフォルト回帰 ---
    // これにより、ジェスチャーをしていないときもうっすら「立ち姿の全身像」が優雅に浮かびます
    if (leftHandTarget.active) {
        smoothLeftHand.x += (leftHandTarget.x - smoothLeftHand.x) * 0.14; 
        smoothLeftHand.y += (leftHandTarget.y - smoothLeftHand.y) * 0.14;
        smoothLeftHand.active = true;
        smoothLeftHand.alpha += (1.0 - smoothLeftHand.alpha) * 0.12; 
    } else {
        // デフォルトの左腕：海藻や水中ダンサーのように、ゆったりとたゆたう波形モーション（直立不動を解消）
        const waveTime = Date.now() * 0.0012;
        
        // 左右非対称・有機的な呼吸ゆらぎをベースに、腕をだらんと下げつつも美しくウェーブさせる
        let baseLX = -0.32 + Math.sin(waveTime * 0.8) * 0.10 + Math.cos(waveTime * 1.7) * 0.03;
        let baseLY = 2.15 + Math.cos(waveTime * 0.6) * 0.14 + Math.sin(waveTime * 1.3) * 0.04;
        
        // 音声（ビート）入力によるクラップ・ウェーブダンス（声や音のテンポで美しく羽ばたく）
        if (micAmp > 0.05) {
            baseLX += (Math.sin(Date.now() * 0.016) * 0.22 - 0.15) * micAmp; // 声に合わせて腕が横にスイング・羽ばたく
            baseLY += Math.cos(Date.now() * 0.016) * 0.25 * micAmp;
        }
        
        let armSpreadLX = baseLX;
        let armSpreadLY = baseLY;
        
        if (smoothEmotion.happy > 0.1) {
            // Happy: 腕が広がり高く舞う ＋ 喜びの小刻みなきらめきウェーブ
            armSpreadLX += -1.25 * smoothEmotion.happy;
            armSpreadLY += -0.55 * smoothEmotion.happy + Math.sin(Date.now() * 0.008) * 0.12 * smoothEmotion.happy;
        }
        if (smoothEmotion.sad > 0.1) {
            // Sad: 力なく内側にだらんと下がり、極めてゆっくり息絶えそうに揺れる
            armSpreadLX += 0.12 * smoothEmotion.sad + Math.sin(waveTime * 0.4) * 0.02 * smoothEmotion.sad;
            armSpreadLY += 0.32 * smoothEmotion.sad + Math.cos(waveTime * 0.3) * 0.04 * smoothEmotion.sad;
        }
        if (smoothEmotion.angry > 0.1) {
            // Angry: 腕をいからせ、怒りのあまりにブルブルと小刻みに震える
            armSpreadLX += -0.25 * smoothEmotion.angry;
            armSpreadLY += -0.65 * smoothEmotion.angry + (Math.random() - 0.5) * 0.08 * smoothEmotion.angry;
        }
        if (smoothEmotion.surprised > 0.1) {
            // Surprised: パッと大きくのけぞり、そのままフリーズ/微振動
            armSpreadLX += -1.75 * smoothEmotion.surprised;
            armSpreadLY += -0.95 * smoothEmotion.surprised + (Math.random() - 0.5) * 0.03 * smoothEmotion.surprised;
        }
        
        const defLX = smoothFace.x + smoothFace.size * armSpreadLX;
        const defLY = smoothFace.y + smoothFace.size * armSpreadLY;
        
        smoothLeftHand.x += (defLX - smoothLeftHand.x) * 0.07;
        smoothLeftHand.y += (defLY - smoothLeftHand.y) * 0.07;
        smoothLeftHand.active = false;
        smoothLeftHand.alpha += (0.45 - smoothLeftHand.alpha) * 0.04; // 腕の位置をうっすらキープ
    }
    
    if (rightHandTarget.active) {
        smoothRightHand.x += (rightHandTarget.x - smoothRightHand.x) * 0.14;
        smoothRightHand.y += (rightHandTarget.y - smoothRightHand.y) * 0.14;
        smoothRightHand.active = true;
        smoothRightHand.alpha += (1.0 - smoothRightHand.alpha) * 0.12;
    } else {
        // 右腕も同様に海藻ウェーブ（左と逆フェーズでより調和のある全身運動に）
        const waveTime = Date.now() * 0.0012;
        
        let baseRX = 0.32 + Math.sin(waveTime * 0.8 + Math.PI) * 0.10 + Math.cos(waveTime * 1.7 + Math.PI) * 0.03;
        let baseRY = 2.15 + Math.cos(waveTime * 0.6 + Math.PI) * 0.14 + Math.sin(waveTime * 1.3 + Math.PI) * 0.04;
        
        // 音声（ビート）入力によるクラップ・ウェーブダンス（左と逆フェーズでシンメトリックに羽ばたく）
        if (micAmp > 0.05) {
            baseRX += (Math.sin(Date.now() * 0.016 + Math.PI) * 0.22 + 0.15) * micAmp;
            baseRY += Math.cos(Date.now() * 0.016 + Math.PI) * 0.25 * micAmp;
        }
        
        let armSpreadRX = baseRX;
        let armSpreadRY = baseRY;
        
        if (smoothEmotion.happy > 0.1) {
            armSpreadRX += 1.25 * smoothEmotion.happy;
            armSpreadRY += -0.55 * smoothEmotion.happy + Math.sin(Date.now() * 0.008 + Math.PI) * 0.12 * smoothEmotion.happy;
        }
        if (smoothEmotion.sad > 0.1) {
            armSpreadRX += -0.12 * smoothEmotion.sad + Math.sin(waveTime * 0.4 + Math.PI) * 0.02 * smoothEmotion.sad;
            armSpreadRY += 0.32 * smoothEmotion.sad + Math.cos(waveTime * 0.3 + Math.PI) * 0.04 * smoothEmotion.sad;
        }
        if (smoothEmotion.angry > 0.1) {
            armSpreadRX += 0.25 * smoothEmotion.angry;
            armSpreadRY += -0.65 * smoothEmotion.angry + (Math.random() - 0.5) * 0.08 * smoothEmotion.angry;
        }
        if (smoothEmotion.surprised > 0.1) {
            armSpreadRX += 1.75 * smoothEmotion.surprised;
            armSpreadRY += -0.95 * smoothEmotion.surprised + (Math.random() - 0.5) * 0.03 * smoothEmotion.surprised;
        }
        
        const defRX = smoothFace.x + smoothFace.size * armSpreadRX;
        const defRY = smoothFace.y + smoothFace.size * armSpreadRY;

        smoothRightHand.x += (defRX - smoothRightHand.x) * 0.07;
        smoothRightHand.y += (defRY - smoothRightHand.y) * 0.07;
        smoothRightHand.active = false;
        smoothRightHand.alpha += (0.45 - smoothRightHand.alpha) * 0.04;
    }
    
    // --- 8d. 手速度追跡・軌跡バースト ＆ 全身モーションスパーク ---
    
    // 左右の手の速度・ベクトル検出と軌跡バースト (Motion-Driven Tail Burst)
    if (prevLeftHand.x === 0 && prevLeftHand.y === 0) {
        prevLeftHand.x = smoothLeftHand.x;
        prevLeftHand.y = smoothLeftHand.y;
    } else {
        const dx = smoothLeftHand.x - prevLeftHand.x;
        const dy = smoothLeftHand.y - prevLeftHand.y;
        const speed = Math.sqrt(dx * dx + dy * dy);
        if (speed > 8.0) {
            spawnMotionBurst(smoothLeftHand.x, smoothLeftHand.y, dx, dy, speed);
        }
        prevLeftHand.x = smoothLeftHand.x;
        prevLeftHand.y = smoothLeftHand.y;
    }

    if (prevRightHand.x === 0 && prevRightHand.y === 0) {
        prevRightHand.x = smoothRightHand.x;
        prevRightHand.y = smoothRightHand.y;
    } else {
        const dx = smoothRightHand.x - prevRightHand.x;
        const dy = smoothRightHand.y - prevRightHand.y;
        const speed = Math.sqrt(dx * dx + dy * dy);
        if (speed > 8.0) {
            spawnMotionBurst(smoothRightHand.x, smoothRightHand.y, dx, dy, speed);
        }
        prevRightHand.x = smoothRightHand.x;
        prevRightHand.y = smoothRightHand.y;
    }

    // 全身の差分モーションによる「全身モーションスパーク」 (Total Body Motion Sparks)
    const totalMotionStrength = activeMotionPoints.length;
    smoothMotionStrength += (totalMotionStrength - smoothMotionStrength) * 0.12;

    if (totalMotionStrength > 120) {
        // 動きの激しさに応じて、1〜5個の鮮やかなきらめく虹色火花を全身からランダムに吹き出させる
        const sparkCount = Math.min(5, Math.floor(totalMotionStrength / 90));
        for (let i = 0; i < sparkCount; i++) {
            if (burstParticles.length < 650) {
                const part = getRandomSkeletonPoint();
                // ランダムな虹色を生成
                const hue = Math.floor(Math.random() * 360);
                const color = hslToRgb(hue, 100, 60);
                
                const bp = new BurstParticle(part.x, part.y, part.z, color, 'vocal', true); // vocalタイプで発光Glowを持たせる
                bp.decay = Math.random() * 0.08 + 0.055; // 軌跡・火花なので極めて速い減衰 (瞬き)
                bp.size = Math.random() * 3.8 + 1.2;
                
                // 四方に爆発的に弾き飛ぶ
                const spread = 4.5;
                bp.vx = (Math.random() - 0.5) * spread;
                bp.vy = (Math.random() - 0.5) * spread;
                bp.vz = (Math.random() - 0.5) * spread;
                
                burstParticles.push(bp);
            }
        }
    }
    
    // UIバーの更新
    updateUiBars();
    
    // 背景のぼかしオーロラのアップデート
    updateBackgroundAurora();
    
    // --- 8e. シンセサイザーの更新 ---
    updateSynthesizer(micAmp);
    
    // --- 8f. パーティクルの更新 ---
    particles.forEach(p => p.update(micAmp));
    
    // --- 8g. バースト・オーラ用粒子の更新 ＆ 描画 ---
    for (let i = burstParticles.length - 1; i >= 0; i--) {
        const bp = burstParticles[i];
        bp.update(micAmp);
        if (bp.life <= 0) {
            burstParticles.splice(i, 1);
        }
    }
    
    // 近接粒子同士を光の細いネットワーク線で繋ぐ
    drawConnections(micAmp);
}

// 関節および隣接する骨格部位の接続判定ヘルパー（不要なクモの巣状のノイズ線を完全に遮断）
function areAdjacentBodyParts(t1, t2) {
    if (t1 === 6 || t2 === 6) return false; // 背景の浮遊粒子は繋がない
    if (t1 === t2) return true; // 同じ部位の粒子同士は繋ぐ
    
    const minT = Math.min(t1, t2);
    const maxT = Math.max(t1, t2);
    
    // 首（頭0 - 肩首1）
    if (minT === 0 && maxT === 1) return true;
    // 左肩・右肩（肩首1 - 左右腕2, 3）
    if (minT === 1 && (maxT === 2 || maxT === 3)) return true;
    // 胸元（肩首1 - 胴体4）
    if (minT === 1 && maxT === 4) return true;
    // 腰（胴体4 - 脚5）
    if (minT === 4 && maxT === 5) return true;
    
    return false;
}

// 粒子同士を結びつけるラインを描画（3D空間上で近い粒子同士をスクリーン投影座標で結ぶ）
function drawConnections(micAmp) {
    // ズーム（骨格サイズ）に応じてネットワークの接続しきい値を動的にスケーリング！
    const baseMaxDist = 32 + 8 * smoothEmotion.sad;
    
    // 全身の動き（smoothMotionStrength）に応じて接続可能な最大距離を拡張
    const motionBonusDist = Math.min(25, smoothMotionStrength * 0.08);
    const maxDistance = (baseMaxDist + motionBonusDist) * (smoothFace.size / 130);
    
    // マイク音量（ビート）および全身の動きの激しさに連動して線の輝度（パルス）をブースト
    const motionBonusBeat = Math.min(1.5, smoothMotionStrength * 0.008);
    const beatBonus = 1.0 + micAmp * 1.5 + motionBonusBeat;
    
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const p1 = particles[i];
            const p2 = particles[j];
            
            // 隣接または同一部位の骨格パーツのみを美しく繋ぐことで、混ざり合うスパイダーウェブ（不要なノイズ線）を完全に排除
            if (!areAdjacentBodyParts(p1.targetType, p2.targetType)) continue;
            
            // 3D空間上の距離で判定！これにより回転しても「星座」の形が美しく保たれます
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dz = p1.z - p2.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (dist < maxDistance) {
                // 投影比率スケール
                const avgScale = (p1.projectedScale + p2.projectedScale) / 2;
                const alpha = (1 - dist / maxDistance) * 0.16 * avgScale * beatBonus;
                
                ctx.beginPath();
                ctx.moveTo(p1.screenX, p1.screenY);
                ctx.lineTo(p2.screenX, p2.screenY);
                
                ctx.strokeStyle = `rgba(${p1.color.r}, ${p1.color.g}, ${p1.color.b}, ${alpha})`;
                ctx.lineWidth = 0.55 * avgScale; // 奥は細く、手前は太く
                ctx.stroke();
            }
        }
    }
}

// UIプログレスバー
function updateUiBars() {
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'neutral']) {
        const valEl = document.getElementById(`val-${key}`);
        const fillEl = document.getElementById(`fill-${key}`);
        if (valEl && fillEl) {
            const percent = Math.round(smoothEmotion[key] * 100);
            valEl.textContent = `${percent}%`;
            fillEl.style.width = `${percent}%`;
        }
    }
}

// 背景オーロラ
function updateBackgroundAurora() {
    const b1 = document.getElementById('aurora-1');
    const b2 = document.getElementById('aurora-2');
    if (!b1 || !b2 || particles.length === 0) return;
    
    const pColor = particles[0].color;
    b1.style.background = `radial-gradient(circle, rgba(${pColor.r}, ${pColor.g}, ${pColor.b}, 0.22) 0%, transparent 75%)`;
    b2.style.background = `radial-gradient(circle, rgba(${pColor.r}, ${pColor.g}, ${pColor.b}, 0.13) 0%, transparent 75%)`;
}


// === 9. UIユーティリティ ===
btnToggleCamera.addEventListener('click', () => {
    const isShowing = btnToggleCamera.classList.toggle('active');
    webcam.style.opacity = isShowing ? '1' : '0';
    document.getElementById('video-mask').style.display = isShowing ? 'block' : 'none';
    
    const icon = btnToggleCamera.querySelector('i');
    icon.setAttribute('data-lucide', isShowing ? 'video' : 'video-off');
    lucide.createIcons();
});

// === 10. マウスドラッグ ＆ タッチ・ホイール操作による3D空間回転・ズームイベントリスナー ===
let touchStartDist = 0;
let initialUserZoom = 1.0;

window.addEventListener('mousedown', (e) => {
    // UIパーツ（ボタン、入力、スライダー、またはグラスカード内）をクリックした場合はカメラ操作を無効化
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.glass-card') || e.target.closest('.glass-header') || e.target.closest('.glass-footer')) {
        return;
    }
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

window.addEventListener('touchstart', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.glass-card') || e.target.closest('.glass-header') || e.target.closest('.glass-footer')) {
        return;
    }
    if (e.touches.length === 2) {
        // 2本指タッチ：モバイルピンチズーム開始
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
        initialUserZoom = targetUserZoom;
        isDragging = false; // ズーム中はドラッグ回転を一時停止
    } else if (e.touches.length === 1) {
        isDragging = true;
        const touch = e.touches[0];
        previousMousePosition = { x: touch.clientX, y: touch.clientY };
    }
}, { passive: true });

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;
    
    targetMouseAngleY += deltaX * 0.005;
    targetMouseAngleX += deltaY * 0.005;
    
    // ピッチ（上下回転角）を制限してアバターが逆さまになるのを防ぐ
    targetMouseAngleX = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, targetMouseAngleX));
    
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

window.addEventListener('touchmove', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.glass-card') || e.target.closest('.glass-header') || e.target.closest('.glass-footer')) {
        return;
    }
    if (e.touches.length === 2 && touchStartDist > 0) {
        // 2本指によるピンチズーム（拡大・縮小）
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const factor = dist / touchStartDist;
        targetUserZoom = initialUserZoom * factor;
        // 限界値をクランプ
        targetUserZoom = Math.max(0.35, Math.min(3.5, targetUserZoom));
    } else if (isDragging && e.touches.length === 1) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - previousMousePosition.x;
        const deltaY = touch.clientY - previousMousePosition.y;
        
        targetMouseAngleY += deltaX * 0.005;
        targetMouseAngleX += deltaY * 0.005;
        
        targetMouseAngleX = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, targetMouseAngleX));
        
        previousMousePosition = { x: touch.clientX, y: touch.clientY };
    }
}, { passive: true });

window.addEventListener('mouseup', () => {
    isDragging = false;
});

window.addEventListener('mouseleave', () => {
    isDragging = false;
});

window.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        touchStartDist = 0;
    }
    if (e.touches.length === 0) {
        isDragging = false;
    }
});

// PC用マウスホイールによるズームイベント
window.addEventListener('wheel', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.glass-card') || e.target.closest('.glass-header') || e.target.closest('.glass-footer')) {
        return;
    }
    // スクロール量（e.deltaY）に応じてカメラズームレベルをスムーズに加減算
    targetUserZoom -= e.deltaY * 0.001;
    targetUserZoom = Math.max(0.35, Math.min(3.5, targetUserZoom));
}, { passive: true });

// ダブルクリック（ダブルタップ）でカメラのアングルおよびズームをすべて滑らかに基準値に初期化
window.addEventListener('dblclick', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.glass-card') || e.target.closest('.glass-header') || e.target.closest('.glass-footer')) {
        return;
    }
    targetMouseAngleX = 0;
    targetMouseAngleY = 0;
    targetUserZoom = 1.0;
});
