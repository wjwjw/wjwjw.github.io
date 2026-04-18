(() => {
	const container = document.getElementById('container');
	const scoreEl = document.getElementById('score');
	const livesEl = document.getElementById('lives');
	const restartBtn = document.getElementById('restart');

	// 开始界面
	const startOverlay = document.getElementById('start-overlay');
	const startBtn = document.getElementById('start-btn');

	// 常量定义
	const MAP_WIDTH = 8;
	const MAP_HEIGHT = 12;
	const BIG_BLOCK = 1;
	
	const MAX_X = MAP_WIDTH - 1;
	const MAX_Z = MAP_WIDTH - 1;
	const MAX_Y = MAP_HEIGHT - 1;

	// 游戏难度设置
	let gameConfig = {
		dropInterval: 1000,
		minDropInterval: 300,
		speedIncreaseRate: 0.97,
		showGhost: true,
		cameraAutoRotate: false,
		scorePerLine: [100, 300, 600, 1000]
	};
	
	let score = 0;
	let lines = 0;
	let level = 1;
	let currentDropInterval = gameConfig.dropInterval;

	// 3D 地图
	let gameMap = Array.from({ length: MAP_WIDTH }, () =>
		Array.from({ length: MAP_HEIGHT }, () =>
			Array(MAP_WIDTH).fill(-1)
		)
	);

	// 游戏对象
	let nowBlock = null;
	let nextBlock = null;
	let ghostBlock = null;
	let blocksGroup = null;

	// 相机控制
	let azimuth = 45.0;
	let cameraAutoRotateSpeed = 0.5;
	const fixedRadius = 20;
	const fixedHeight = 12;
	
	// 鼠标/触摸控制
	let isDragging = false;
	let dragStartX = 0;
	let dragAzimuth = 0;
	
	// 游戏状态
	let running = false;
	let paused = false;
	let lastDropTime = 0;
	
	// 预览旋转的临时方块
	let previewTimeout = null;
	
	// 调试日志开关
	const DEBUG = false;
	function log(...args) {
		if (DEBUG) console.log(...args);
	}
	
	// UI面板
	const uiPanel = document.createElement('div');
	uiPanel.style.position = 'absolute';
	uiPanel.style.top = '10px';
	uiPanel.style.right = '10px';
	uiPanel.style.backgroundColor = 'rgba(0,0,0,0.8)';
	uiPanel.style.color = '#fff';
	uiPanel.style.fontFamily = 'monospace';
	uiPanel.style.fontSize = '14px';
	uiPanel.style.padding = '10px';
	uiPanel.style.zIndex = '100';
	uiPanel.style.borderRadius = '5px';
	uiPanel.style.textAlign = 'right';
	uiPanel.innerHTML = `
		<div style="font-size:18px; margin-bottom:5px;">🎮 方块</div>
		<div>得分: <span id="ui-score">0</span></div>
		<div>行数: <span id="ui-lines">0</span></div>
		<div>等级: <span id="ui-level">1</span></div>
		<div style="font-size:10px; color:#aaa; margin-top:5px;">Q/W/E/R/T/Y 旋转 | C 换形状</div>
	`;
	document.body.appendChild(uiPanel);
	
	// 创建左侧按钮容器（旋转按钮）
	const leftButtonContainer = document.createElement('div');
	leftButtonContainer.style.position = 'absolute';
	leftButtonContainer.style.bottom = '20px';
	leftButtonContainer.style.left = '20px';
	leftButtonContainer.style.display = 'flex';
	leftButtonContainer.style.flexDirection = 'column';
	leftButtonContainer.style.gap = '10px';
	leftButtonContainer.style.zIndex = '200';
	document.body.appendChild(leftButtonContainer);
	
	// 创建右侧按钮容器（移动和功能按钮）
	const rightButtonContainer = document.createElement('div');
	rightButtonContainer.style.position = 'absolute';
	rightButtonContainer.style.bottom = '20px';
	rightButtonContainer.style.right = '20px';
	rightButtonContainer.style.display = 'flex';
	rightButtonContainer.style.flexDirection = 'column';
	rightButtonContainer.style.gap = '10px';
	rightButtonContainer.style.zIndex = '200';
	document.body.appendChild(rightButtonContainer);
	
	// 按钮样式
	const buttonStyle = `
		width: 70px;
		height: 70px;
		border-radius: 35px;
		background: rgba(0,0,0,0.8);
		border: 2px solid #ffaa44;
		color: #ffaa44;
		font-size: 24px;
		font-weight: bold;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		box-shadow: 0 2px 10px rgba(0,0,0,0.3);
		touch-action: manipulation;
		position: relative;
	`;
	
	// 预览容器（用于按钮悬停）
	const hoverPreviewContainer = document.createElement('div');
	hoverPreviewContainer.style.position = 'absolute';
	hoverPreviewContainer.style.bottom = '120px';
	hoverPreviewContainer.style.left = '100px';
	hoverPreviewContainer.style.backgroundColor = 'rgba(0,0,0,0.85)';
	hoverPreviewContainer.style.borderRadius = '10px';
	hoverPreviewContainer.style.padding = '10px';
	hoverPreviewContainer.style.border = '1px solid #ffaa44';
	hoverPreviewContainer.style.zIndex = '250';
	hoverPreviewContainer.style.display = 'none';
	hoverPreviewContainer.style.flexDirection = 'column';
	hoverPreviewContainer.style.alignItems = 'center';
	hoverPreviewContainer.style.gap = '5px';
	hoverPreviewContainer.innerHTML = `
		<div style="color:#ffaa44; font-size:12px;">旋转预览</div>
		<div id="hover-preview-canvas" style="width:80px; height:80px;"></div>
		<div style="color:#aaa; font-size:10px;" id="hover-preview-text">绕X轴顺时针</div>
	`;
	document.body.appendChild(hoverPreviewContainer);
	
	let hoverPreviewRenderer = null;
	
	function showHoverPreview(axis, clockwise, block) {
		if (!block) return;
		
		if (previewTimeout) clearTimeout(previewTimeout);
		
		let previewBlock = block.clone();
		previewBlock.rotateAroundCenter(axis, clockwise);
		
		const container = document.getElementById('hover-preview-canvas');
		if (!container) return;
		
		if (!hoverPreviewRenderer) {
			hoverPreviewRenderer = new THREE.WebGLRenderer({ antialias: true });
			hoverPreviewRenderer.setSize(80, 80);
			container.appendChild(hoverPreviewRenderer.domElement);
		}
		
		while(container.firstChild && container.firstChild !== hoverPreviewRenderer.domElement) {
			container.removeChild(container.firstChild);
		}
		if (!container.contains(hoverPreviewRenderer.domElement)) {
			container.appendChild(hoverPreviewRenderer.domElement);
		}
		
		const previewScene = new THREE.Scene();
		previewScene.background = new THREE.Color(0x1a1a2e);
		
		const previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
		previewCamera.position.set(2, 2, 3);
		previewCamera.lookAt(0, 0, 0);
		
		const previewLight = new THREE.DirectionalLight(0xffffff, 0.8);
		previewLight.position.set(1, 2, 1);
		previewScene.add(previewLight);
		previewScene.add(new THREE.AmbientLight(0x444444));
		
		const meshes = previewBlock.createMeshes(false);
		const bounds = previewBlock.getBounds();
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;
		const centerZ = (bounds.minZ + bounds.maxZ) / 2;
		
		meshes.forEach(mesh => {
			mesh.position.x -= centerX;
			mesh.position.y -= centerY;
			mesh.position.z -= centerZ;
			previewScene.add(mesh);
		});
		
		hoverPreviewRenderer.render(previewScene, previewCamera);
		
		meshes.forEach(mesh => {
			previewScene.remove(mesh);
			if (mesh.material) mesh.material.dispose();
		});
		
		hoverPreviewContainer.style.display = 'flex';
		
		const axisName = { 'X': 'X轴', 'Y': 'Y轴', 'Z': 'Z轴' }[axis];
		const dirName = clockwise ? '顺时针' : '逆时针';
		const textSpan = document.getElementById('hover-preview-text');
		if (textSpan) textSpan.textContent = `${axisName} ${dirName}旋转`;
		
		previewTimeout = setTimeout(() => {
			hoverPreviewContainer.style.display = 'none';
		}, 2000);
	}
	
	function hideHoverPreview() {
		if (previewTimeout) clearTimeout(previewTimeout);
		hoverPreviewContainer.style.display = 'none';
	}
	
	function createButton(text, onClick, color = '#ffaa44', axis = null, clockwise = null) {
		const btn = document.createElement('button');
		btn.textContent = text;
		btn.style.cssText = buttonStyle;
		btn.style.background = `rgba(0,0,0,0.85)`;
		btn.style.borderColor = color;
		btn.style.color = color;
		
		if (axis && clockwise && nowBlock) {
			btn.addEventListener('mouseenter', () => {
				if (nowBlock) showHoverPreview(axis, clockwise, nowBlock);
			});
			btn.addEventListener('mouseleave', () => {
				hideHoverPreview();
			});
			btn.addEventListener('touchstart', (e) => {
				if (nowBlock) showHoverPreview(axis, clockwise, nowBlock);
			});
		}
		
		btn.addEventListener('click', onClick);
		btn.addEventListener('touchstart', (e) => {
			e.preventDefault();
			onClick();
		});
		return btn;
	}
	
	// ========== 左侧：旋转按钮组 ==========
	const rotateGroup = document.createElement('div');
	rotateGroup.style.display = 'flex';
	rotateGroup.style.flexDirection = 'column';
	rotateGroup.style.gap = '8px';
	rotateGroup.style.marginBottom = '10px';
	
	const rotateTitle = document.createElement('div');
	rotateTitle.textContent = '🔄 旋转';
	rotateTitle.style.cssText = `
		color: #ffaa44;
		font-size: 11px;
		text-align: center;
		margin-bottom: 5px;
		font-family: monospace;
	`;
	rotateGroup.appendChild(rotateTitle);
	
	// 绕X轴旋转
	const rotateXGroup = document.createElement('div');
	rotateXGroup.style.display = 'flex';
	rotateXGroup.style.gap = '8px';
	rotateXGroup.style.justifyContent = 'center';
	
	const btnRotateXp = createButton('↺ X', () => rotateBlock('X', true), '#ff6666', 'X', true);
	const btnRotateXm = createButton('↻ X', () => rotateBlock('X', false), '#ff6666', 'X', false);
	rotateXGroup.appendChild(btnRotateXp);
	rotateXGroup.appendChild(btnRotateXm);
	
	// 绕Y轴旋转
	const rotateYGroup = document.createElement('div');
	rotateYGroup.style.display = 'flex';
	rotateYGroup.style.gap = '8px';
	rotateYGroup.style.justifyContent = 'center';
	
	const btnRotateYp = createButton('↺ Y', () => rotateBlock('Y', true), '#66ff66', 'Y', true);
	const btnRotateYm = createButton('↻ Y', () => rotateBlock('Y', false), '#66ff66', 'Y', false);
	rotateYGroup.appendChild(btnRotateYp);
	rotateYGroup.appendChild(btnRotateYm);
	
	// 绕Z轴旋转
	const rotateZGroup = document.createElement('div');
	rotateZGroup.style.display = 'flex';
	rotateZGroup.style.gap = '8px';
	rotateZGroup.style.justifyContent = 'center';
	
	const btnRotateZp = createButton('↺ Z', () => rotateBlock('Z', true), '#6666ff', 'Z', true);
	const btnRotateZm = createButton('↻ Z', () => rotateBlock('Z', false), '#6666ff', 'Z', false);
	rotateZGroup.appendChild(btnRotateZp);
	rotateZGroup.appendChild(btnRotateZm);
	
	rotateGroup.appendChild(rotateXGroup);
	rotateGroup.appendChild(rotateYGroup);
	rotateGroup.appendChild(rotateZGroup);
	
	leftButtonContainer.appendChild(rotateGroup);
	
	// ========== 右侧：移动按钮组 ==========
	const moveGroup = document.createElement('div');
	moveGroup.style.display = 'flex';
	moveGroup.style.flexDirection = 'column';
	moveGroup.style.gap = '5px';
	moveGroup.style.marginBottom = '10px';
	moveGroup.style.alignItems = 'center';
	
	const moveTitle = document.createElement('div');
	moveTitle.textContent = '🎮 移动';
	moveTitle.style.cssText = `
		color: #88aaff;
		font-size: 11px;
		text-align: center;
		margin-bottom: 5px;
		font-family: monospace;
	`;
	moveGroup.appendChild(moveTitle);
	
	const moveUpRow = document.createElement('div');
	moveUpRow.style.display = 'flex';
	moveUpRow.style.justifyContent = 'center';
	
	const moveMiddleRow = document.createElement('div');
	moveMiddleRow.style.display = 'flex';
	moveMiddleRow.style.gap = '8px';
	moveMiddleRow.style.justifyContent = 'center';
	
	const moveDownRow = document.createElement('div');
	moveDownRow.style.display = 'flex';
	moveDownRow.style.justifyContent = 'center';
	
	const btnMoveUp = createButton('⬆', () => moveCameraRelative('forward'), '#88aaff');
	const btnMoveDown = createButton('⬇', () => moveCameraRelative('backward'), '#88aaff');
	const btnMoveLeft = createButton('⬅', () => moveCameraRelative('left'), '#88aaff');
	const btnMoveRight = createButton('➡', () => moveCameraRelative('right'), '#88aaff');
	
	moveUpRow.appendChild(btnMoveUp);
	moveMiddleRow.appendChild(btnMoveLeft);
	moveMiddleRow.appendChild(btnMoveRight);
	moveDownRow.appendChild(btnMoveDown);
	
	moveGroup.appendChild(moveUpRow);
	moveGroup.appendChild(moveMiddleRow);
	moveGroup.appendChild(moveDownRow);
	
	// 功能按钮组
	const actionGroup = document.createElement('div');
	actionGroup.style.display = 'flex';
	actionGroup.style.gap = '8px';
	actionGroup.style.marginBottom = '10px';
	actionGroup.style.justifyContent = 'center';
	
	const btnHardDrop = createButton('💥 下落', () => hardDrop(), '#ff4444');
	const btnPause = createButton('⏸ 暂停', () => togglePause(), '#ffaa44');
	const btnRestart = createButton('🔄 重来', () => restartGame(), '#44ff44');
	const btnChangeShape = createButton('🎲 换形', () => changeShape(), '#ffaa44');
	
	actionGroup.appendChild(btnHardDrop);
	actionGroup.appendChild(btnPause);
	actionGroup.appendChild(btnRestart);
	actionGroup.appendChild(btnChangeShape);
	
	rightButtonContainer.appendChild(moveGroup);
	rightButtonContainer.appendChild(actionGroup);
	
	// 提示面板
	const hintPanel = document.createElement('div');
	hintPanel.style.position = 'absolute';
	hintPanel.style.bottom = '20px';
	hintPanel.style.left = '50%';
	hintPanel.style.transform = 'translateX(-50%)';
	hintPanel.style.backgroundColor = 'rgba(0,0,0,0.7)';
	hintPanel.style.padding = '8px 12px';
	hintPanel.style.borderRadius = '5px';
	hintPanel.style.fontSize = '11px';
	hintPanel.style.color = '#aaa';
	hintPanel.style.fontFamily = 'monospace';
	hintPanel.style.zIndex = '100';
	hintPanel.style.whiteSpace = 'nowrap';
	hintPanel.innerHTML = `
		<div>💡 拖拽旋转视角 | Q/W E/R T/Y 旋转 | C 换形状 | 空格下落</div>
	`;
	document.body.appendChild(hintPanel);
	
	// 暂停提示
	const pauseHint = document.createElement('div');
	pauseHint.style.position = 'absolute';
	pauseHint.style.top = '50%';
	pauseHint.style.left = '50%';
	pauseHint.style.transform = 'translate(-50%, -50%)';
	pauseHint.style.backgroundColor = 'rgba(0,0,0,0.9)';
	pauseHint.style.color = '#ffaa44';
	pauseHint.style.fontFamily = 'monospace';
	pauseHint.style.fontSize = '20px';
	pauseHint.style.padding = '20px 40px';
	pauseHint.style.zIndex = '100';
	pauseHint.style.borderRadius = '10px';
	pauseHint.style.border = '2px solid #ffaa44';
	pauseHint.style.textAlign = 'center';
	pauseHint.style.display = 'none';
	pauseHint.innerHTML = `
		<div>⏸ 暂停</div>
		<div style="font-size:12px; margin-top:10px;">点击暂停按钮继续</div>
		<div style="font-size:10px; color:#aaa; margin-top:5px;">💡 暂停时可以移动/旋转/换形</div>
	`;
	document.body.appendChild(pauseHint);
	
	function updateUI() {
		const scoreSpan = document.getElementById('ui-score');
		const linesSpan = document.getElementById('ui-lines');
		const levelSpan = document.getElementById('ui-level');
		if (scoreSpan) scoreSpan.textContent = score;
		if (linesSpan) linesSpan.textContent = lines;
		if (levelSpan) levelSpan.textContent = level;
		if (scoreEl) scoreEl.textContent = score;
		if (livesEl) livesEl.textContent = lines;
	}
	
	// 根据相机角度计算移动方向
	function getCameraRelativeDirection(direction) {
		const angleRad = azimuth * Math.PI / 180;
		const cos = Math.cos(angleRad);
		const sin = Math.sin(angleRad);
		
		switch(direction) {
			case 'forward':
				return { dx: -Math.round(sin), dz: -Math.round(cos) };
			case 'backward':
				return { dx: Math.round(sin), dz: Math.round(cos) };
			case 'left':
				return { dx: -Math.round(cos), dz: Math.round(sin) };
			case 'right':
				return { dx: Math.round(cos), dz: -Math.round(sin) };
			default:
				return { dx: 0, dz: 0 };
		}
	}
	
	function moveCameraRelative(direction) {
		if (!nowBlock || !running) return;
		
		const { dx, dz } = getCameraRelativeDirection(direction);
		if (dx === 0 && dz === 0) return;
		
		let newBlock = nowBlock.clone();
		newBlock.setPosition(
			nowBlock.position[0] + dx,
			nowBlock.position[1],
			nowBlock.position[2] + dz
		);
		newBlock.center[0] = nowBlock.center[0] + dx;
		newBlock.center[2] = nowBlock.center[2] + dz;
		
		if (paused) {
			const positions = newBlock.getAllBlockPositions();
			let valid = true;
			for (const { x, y, z } of positions) {
				if (x < 0 || x > MAX_X || z < 0 || z > MAX_Z || y < 0 || y > MAX_Y) {
					valid = false;
					break;
				}
			}
			if (valid) {
				nowBlock = newBlock;
				if (gameConfig.showGhost) {
					ghostBlock = calculateGhostBlock(nowBlock);
				}
			}
		} else {
			if (checkCollision(newBlock) === 0) {
				nowBlock = newBlock;
				if (gameConfig.showGhost) {
					ghostBlock = calculateGhostBlock(nowBlock);
				}
			}
		}
	}
	
	function rotateBlock(axis, clockwise) {
		if (!nowBlock || !running) return;
		
		let newBlock = nowBlock.clone();
		newBlock = newBlock.rotateAroundCenter(axis, clockwise);
		
		if (checkCollision(newBlock) === 0) {
			nowBlock = newBlock;
			if (gameConfig.showGhost) {
				ghostBlock = calculateGhostBlock(nowBlock);
			}
		}
	}
	
	// 改变当前方块形状
	function changeShape() {
		if (!nowBlock || !running) return;
		
		// 保存当前位置
		const oldPosition = [...nowBlock.position];
		const oldCenter = [...nowBlock.center];
		
		// 创建新形状
		let newBlock = createRandomBlock();
		
		// 尝试将新形状放置到原位置附近
		newBlock.setPosition(oldPosition[0], oldPosition[1], oldPosition[2]);
		newBlock.center = [...oldCenter];
		
		// 检查是否超出边界
		const bounds = newBlock.getBounds();
		let adjustX = 0, adjustZ = 0;
		
		if (bounds.minX < 0) adjustX = -bounds.minX;
		else if (bounds.maxX > MAX_X) adjustX = MAX_X - bounds.maxX;
		
		if (bounds.minZ < 0) adjustZ = -bounds.minZ;
		else if (bounds.maxZ > MAX_Z) adjustZ = MAX_Z - bounds.maxZ;
		
		if (adjustX !== 0 || adjustZ !== 0) {
			newBlock.setPosition(
				newBlock.position[0] + adjustX,
				newBlock.position[1],
				newBlock.position[2] + adjustZ
			);
			newBlock.center[0] += adjustX;
			newBlock.center[2] += adjustZ;
		}
		
		// 检查碰撞
		if (checkCollision(newBlock) === 0) {
			nowBlock = newBlock;
			if (gameConfig.showGhost) {
				ghostBlock = calculateGhostBlock(nowBlock);
			}
			log('改变形状成功');
		} else {
			log('改变形状失败（碰撞）');
		}
	}
	
	// 创建随机形状方块（不带位置，只设置形状）
	function createRandomBlock() {
		const shapes = [
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,1,4]], color: [0,1,1], name: 'I' },
			{ dis: [[1,1,1], [1,1,2], [1,2,1], [1,2,2]], color: [1,1,0], name: 'O' },
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,2,2]], color: [1,0,1], name: 'T' },
			{ dis: [[1,1,2], [1,1,3], [1,2,1], [1,2,2]], color: [0,1,0], name: 'S' },
			{ dis: [[1,1,1], [1,1,2], [1,2,2], [1,2,3]], color: [1,0,0], name: 'Z' },
			{ dis: [[1,1,1], [1,2,1], [1,3,1], [1,3,2]], color: [0,0,1], name: 'J' },
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,2,3]], color: [1,0.5,0], name: 'L' }
		];
		const shape = shapes[Math.floor(Math.random() * shapes.length)];
		const block = new Blocks();
		
		block.setNumBlock(shape.dis.length);
		for (let i = 0; i < shape.dis.length; i++) {
			block.setDis(i, 0, shape.dis[i][0]);
			block.setDis(i, 1, shape.dis[i][1]);
			block.setDis(i, 2, shape.dis[i][2]);
		}
		block.setColor(shape.color[0], shape.color[1], shape.color[2]);
		
		block.calculateCenter();
		
		return block;
	}
	
	// Three.js 场景
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0a0a0a);
	scene.fog = new THREE.FogExp2(0x0a0a0a, 0.008);

	const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
	updateCamera();

	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	container.appendChild(renderer.domElement);

	// 灯光
	const ambientLight = new THREE.AmbientLight(0x404040);
	scene.add(ambientLight);
	
	const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
	mainLight.position.set(8, 15, 10);
	scene.add(mainLight);
	
	const fillLight = new THREE.PointLight(0x4466cc, 0.3);
	fillLight.position.set(3, 5, 8);
	scene.add(fillLight);
	
	const backLight = new THREE.PointLight(0xffaa66, 0.2);
	backLight.position.set(4, 6, -3);
	scene.add(backLight);
	
	const rimLight = new THREE.PointLight(0xff66aa, 0.2);
	rimLight.position.set(-2, 5, -5);
	scene.add(rimLight);

	// 预创建几何体
	const boxGeometry = new THREE.BoxGeometry(BIG_BLOCK * 0.92, BIG_BLOCK * 0.92, BIG_BLOCK * 0.92);
	const placedMaterial = new THREE.MeshStandardMaterial({ 
		color: 0x88aaff, 
		roughness: 0.3, 
		metalness: 0.1,
		transparent: true,
		opacity: 0.85
	});
	
	const ghostMaterial = new THREE.MeshStandardMaterial({
		color: 0x88aaff,
		roughness: 0.5,
		metalness: 0.0,
		transparent: true,
		opacity: 0.3,
		emissive: 0x224466
	});

	// 方块类
	class Blocks {
		constructor() {
			this.position = [0, 0, 0];
			this.center = [0, 0, 0];
			this.numBlock = 4;
			this.dis = Array(4).fill().map(() => [0, 0, 0]);
			this.color = [1, 1, 1];
			this.meshes = [];
		}

		setPosition(x, y, z) {
			this.position[0] = x;
			this.position[1] = y;
			this.position[2] = z;
		}

		setColor(r, g, b) {
			this.color[0] = r;
			this.color[1] = g;
			this.color[2] = b;
		}

		setNumBlock(n) {
			this.numBlock = n;
		}

		setDis(nBlock, nIjk, num) {
			if (nBlock < this.numBlock && nIjk < 3) {
				this.dis[nBlock][nIjk] = num;
			}
		}

		getPosition(n) {
			return n < 3 ? this.position[n] : -1;
		}

		getDis(nBlock, nIjk) {
			return (nBlock < this.numBlock && nIjk < 3) ? this.dis[nBlock][nIjk] : -1;
		}

		getNumBlock() {
			return this.numBlock;
		}
		
		calculateCenter() {
			const bounds = this.getBounds();
			this.center[0] = (bounds.minX + bounds.maxX) / 2;
			this.center[1] = (bounds.minY + bounds.maxY) / 2;
			this.center[2] = (bounds.minZ + bounds.maxZ) / 2;
		}

		clone() {
			const newBlock = new Blocks();
			newBlock.position = [...this.position];
			newBlock.center = [...this.center];
			newBlock.numBlock = this.numBlock;
			newBlock.dis = this.dis.map(d => [...d]);
			newBlock.color = [...this.color];
			return newBlock;
		}

		move(howToMove) {
			const moveDis = [
				[0, 0, 0],
				[0, 0, -1],
				[1, 0, 0],
				[0, 0, 1],
				[-1, 0, 0],
				[0, -1, 0]
			];
			const newBlock = this.clone();
			newBlock.setPosition(
				this.position[0] + moveDis[howToMove][0],
				this.position[1] + moveDis[howToMove][1],
				this.position[2] + moveDis[howToMove][2]
			);
			newBlock.center[0] = this.center[0] + moveDis[howToMove][0];
			newBlock.center[1] = this.center[1] + moveDis[howToMove][1];
			newBlock.center[2] = this.center[2] + moveDis[howToMove][2];
			return newBlock;
		}
		
		rotateAroundCenter(axis, clockwise) {
			const worldPositions = [];
			for (let i = 0; i < this.numBlock; i++) {
				const wx = this.position[0] + (this.dis[i][0] - 1);
				const wy = this.position[1] + (this.dis[i][1] - 1);
				const wz = this.position[2] + (this.dis[i][2] - 1);
				worldPositions.push({ wx, wy, wz });
			}
			
			const sign = clockwise ? 1 : -1;
			const newWorldPositions = [];
			
			for (const { wx, wy, wz } of worldPositions) {
				const rx = wx - this.center[0];
				const ry = wy - this.center[1];
				const rz = wz - this.center[2];
				
				let newRx, newRy, newRz;
				
				switch(axis) {
					case 'X':
						newRx = rx;
						newRy = sign * rz;
						newRz = -sign * ry;
						break;
					case 'Y':
						newRx = sign * rz;
						newRy = ry;
						newRz = -sign * rx;
						break;
					case 'Z':
						newRx = sign * ry;
						newRy = -sign * rx;
						newRz = rz;
						break;
					default:
						newRx = rx; newRy = ry; newRz = rz;
				}
				
				newWorldPositions.push({
					wx: Math.round(newRx + this.center[0]),
					wy: Math.round(newRy + this.center[1]),
					wz: Math.round(newRz + this.center[2])
				});
			}
			
			let minX = Infinity, minY = Infinity, minZ = Infinity;
			for (const { wx, wy, wz } of newWorldPositions) {
				minX = Math.min(minX, wx);
				minY = Math.min(minY, wy);
				minZ = Math.min(minZ, wz);
			}
			
			const newBlock = this.clone();
			newBlock.setPosition(minX, minY, minZ);
			
			for (let i = 0; i < this.numBlock; i++) {
				const { wx, wy, wz } = newWorldPositions[i];
				newBlock.setDis(i, 0, wx - newBlock.position[0] + 1);
				newBlock.setDis(i, 1, wy - newBlock.position[1] + 1);
				newBlock.setDis(i, 2, wz - newBlock.position[2] + 1);
			}
			
			newBlock.center = [...this.center];
			
			const bounds = newBlock.getBounds();
			let adjustX = 0, adjustZ = 0;
			
			if (bounds.minX < 0) adjustX = -bounds.minX;
			else if (bounds.maxX > MAX_X) adjustX = MAX_X - bounds.maxX;
			
			if (bounds.minZ < 0) adjustZ = -bounds.minZ;
			else if (bounds.maxZ > MAX_Z) adjustZ = MAX_Z - bounds.maxZ;
			
			if (adjustX !== 0 || adjustZ !== 0) {
				newBlock.setPosition(
					newBlock.position[0] + adjustX,
					newBlock.position[1],
					newBlock.position[2] + adjustZ
				);
				newBlock.center[0] += adjustX;
				newBlock.center[2] += adjustZ;
			}
			
			return newBlock;
		}

		createMeshes(isGhost = false) {
			this.meshes.forEach(mesh => {
				if (mesh.parent) mesh.parent.remove(mesh);
			});
			this.meshes = [];
			
			const material = isGhost ? ghostMaterial : new THREE.MeshStandardMaterial({
				color: new THREE.Color(this.color[0], this.color[1], this.color[2]),
				roughness: 0.2,
				metalness: 0.05,
				emissive: new THREE.Color(this.color[0] * 0.3, this.color[1] * 0.3, this.color[2] * 0.3)
			});
			
			for (let i = 0; i < this.numBlock; i++) {
				const mesh = new THREE.Mesh(boxGeometry, isGhost ? material : material.clone());
				const worldX = this.position[0] + (this.dis[i][0] - 1) + 0.5;
				const worldY = this.position[1] + (this.dis[i][1] - 1) + 0.5;
				const worldZ = this.position[2] + (this.dis[i][2] - 1) + 0.5;
				mesh.position.set(worldX, worldY, worldZ);
				this.meshes.push(mesh);
			}
			return this.meshes;
		}
		
		getAllBlockPositions() {
			const positions = [];
			for (let i = 0; i < this.numBlock; i++) {
				const x = this.position[0] + (this.dis[i][0] - 1);
				const y = this.position[1] + (this.dis[i][1] - 1);
				const z = this.position[2] + (this.dis[i][2] - 1);
				positions.push({ x, y, z });
			}
			return positions;
		}
		
		getBounds() {
			const positions = this.getAllBlockPositions();
			let minX = Infinity, maxX = -Infinity;
			let minY = Infinity, maxY = -Infinity;
			let minZ = Infinity, maxZ = -Infinity;
			
			for (const { x, y, z } of positions) {
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
				minZ = Math.min(minZ, z);
				maxZ = Math.max(maxZ, z);
			}
			
			return { minX, maxX, minY, maxY, minZ, maxZ };
		}
	}

	function checkCollision(block) {
		if (!block) return -1;
		
		const positions = block.getAllBlockPositions();
		
		for (const { x, y, z } of positions) {
			if (x < 0 || x > MAX_X) return 2;
			if (z < 0 || z > MAX_Z) return 3;
			if (y < 0) return 5;
			if (y > MAX_Y) return 5;
			if (gameMap[x] && gameMap[x][y] && gameMap[x][y][z] !== -1) return -1;
		}
		return 0;
	}
	
	function calculateGhostBlock(block) {
		if (!block) return null;
		
		let ghost = block.clone();
		let dropCount = 0;
		const MAX_DROP_STEPS = MAP_HEIGHT;
		
		while (dropCount < MAX_DROP_STEPS) {
			const testBlock = ghost.move(5);
			if (checkCollision(testBlock) === 0) {
				ghost = testBlock;
				dropCount++;
			} else {
				break;
			}
		}
		return ghost;
	}
	
	function clearLines() {
		let linesCleared = 0;
		
		for (let y = 0; y < MAP_HEIGHT; y++) {
			let isFull = true;
			for (let x = 0; x < MAP_WIDTH; x++) {
				for (let z = 0; z < MAP_WIDTH; z++) {
					if (gameMap[x][y][z] === -1) {
						isFull = false;
						break;
					}
				}
				if (!isFull) break;
			}
			
			if (isFull) {
				for (let i = y; i < MAP_HEIGHT - 1; i++) {
					for (let x = 0; x < MAP_WIDTH; x++) {
						for (let z = 0; z < MAP_WIDTH; z++) {
							gameMap[x][i][z] = gameMap[x][i + 1][z];
						}
					}
				}
				for (let x = 0; x < MAP_WIDTH; x++) {
					for (let z = 0; z < MAP_WIDTH; z++) {
						gameMap[x][MAP_HEIGHT - 1][z] = -1;
					}
				}
				linesCleared++;
				y--;
			}
		}
		
		if (linesCleared > 0) {
			const scoreIndex = Math.min(linesCleared, gameConfig.scorePerLine.length) - 1;
			const addScore = gameConfig.scorePerLine[scoreIndex] * level;
			score += addScore;
			lines += linesCleared;
			
			const newLevel = Math.floor(lines / 10) + 1;
			if (newLevel > level) {
				level = newLevel;
				currentDropInterval = Math.max(
					gameConfig.minDropInterval,
					gameConfig.dropInterval * Math.pow(gameConfig.speedIncreaseRate, lines / 10)
				);
			}
			updateUI();
		}
		return linesCleared;
	}

	function createNewBlock() {
		const shapes = [
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,1,4]], color: [0,1,1], name: 'I' },
			{ dis: [[1,1,1], [1,1,2], [1,2,1], [1,2,2]], color: [1,1,0], name: 'O' },
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,2,2]], color: [1,0,1], name: 'T' },
			{ dis: [[1,1,2], [1,1,3], [1,2,1], [1,2,2]], color: [0,1,0], name: 'S' },
			{ dis: [[1,1,1], [1,1,2], [1,2,2], [1,2,3]], color: [1,0,0], name: 'Z' },
			{ dis: [[1,1,1], [1,2,1], [1,3,1], [1,3,2]], color: [0,0,1], name: 'J' },
			{ dis: [[1,1,1], [1,1,2], [1,1,3], [1,2,3]], color: [1,0.5,0], name: 'L' }
		];
		const shape = shapes[Math.floor(Math.random() * shapes.length)];
		const block = new Blocks();
		
		let minX = Infinity, maxX = -Infinity;
		let minZ = Infinity, maxZ = -Infinity;
		let maxY = 0;
		
		for (let i = 0; i < shape.dis.length; i++) {
			const x = shape.dis[i][0] - 1;
			const z = shape.dis[i][2] - 1;
			const y = shape.dis[i][1] - 1;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
			maxY = Math.max(maxY, y);
		}
		
		const width = maxX - minX;
		const depth = maxZ - minZ;
		const spawnX = Math.floor((MAP_WIDTH - 1 - width) / 2) - minX;
		const spawnZ = Math.floor((MAP_WIDTH - 1 - depth) / 2) - minZ;
		const spawnY = MAX_Y - maxY;
		
		block.setPosition(spawnX, spawnY, spawnZ);
		block.setNumBlock(shape.dis.length);
		for (let i = 0; i < shape.dis.length; i++) {
			block.setDis(i, 0, shape.dis[i][0]);
			block.setDis(i, 1, shape.dis[i][1]);
			block.setDis(i, 2, shape.dis[i][2]);
		}
		block.setColor(shape.color[0], shape.color[1], shape.color[2]);
		
		block.calculateCenter();
		
		return block;
	}

	function drawAllBlocks() {
		if (!blocksGroup) {
			blocksGroup = new THREE.Group();
			blocksGroup.userData = { isBlocks: true };
			scene.add(blocksGroup);
		}
		
		while(blocksGroup.children.length > 0) {
			const child = blocksGroup.children[0];
			if (child.isMesh && child.material) {
				child.material.dispose();
			}
			blocksGroup.remove(child);
		}
		
		for (let i = 0; i < MAP_WIDTH; i++) {
			for (let j = 0; j < MAP_HEIGHT; j++) {
				for (let k = 0; k < MAP_WIDTH; k++) {
					if (gameMap[i] && gameMap[i][j] && gameMap[i][j][k] === 1) {
						const mesh = new THREE.Mesh(boxGeometry, placedMaterial.clone());
						mesh.position.set(i + 0.5, j + 0.5, k + 0.5);
						blocksGroup.add(mesh);
					}
				}
			}
		}
		
		if (gameConfig.showGhost && ghostBlock && running) {
			const ghostMeshes = ghostBlock.createMeshes(true);
			ghostMeshes.forEach(mesh => {
				if (paused) {
					mesh.material.opacity = 0.5;
					mesh.material.emissive = new THREE.Color(0xffaa44);
					mesh.material.emissiveIntensity = 0.3;
				}
				blocksGroup.add(mesh);
			});
		}
		
		if (nowBlock) {
			const meshes = nowBlock.createMeshes(false);
			meshes.forEach(mesh => {
				if (paused) {
					mesh.material.transparent = true;
					mesh.material.opacity = 0.7;
					mesh.material.emissive = new THREE.Color(0xffaa44);
					mesh.material.emissiveIntensity = 0.2;
				}
				blocksGroup.add(mesh);
			});
		}
		
		return blocksGroup;
	}

	function updateCamera() {
		const centerX = MAP_WIDTH / 2;
		const centerZ = MAP_WIDTH / 2;
		const centerY = MAP_HEIGHT / 2;
		const angle = THREE.MathUtils.degToRad(azimuth);
		
		camera.position.x = centerX + fixedRadius * Math.sin(angle);
		camera.position.z = centerZ + fixedRadius * Math.cos(angle);
		camera.position.y = fixedHeight;
		camera.lookAt(centerX, centerY, centerZ);
	}

	function resetMap() {
		for (let i = 0; i < MAP_WIDTH; i++) {
			for (let j = 0; j < MAP_HEIGHT; j++) {
				for (let k = 0; k < MAP_WIDTH; k++) {
					gameMap[i][j][k] = -1;
				}
			}
		}
	}

	function placeBlock(block) {
		const positions = block.getAllBlockPositions();
		for (const { x, y, z } of positions) {
			if (x >= 0 && x < MAP_WIDTH && 
				y >= 0 && y < MAP_HEIGHT && 
				z >= 0 && z < MAP_WIDTH) {
				gameMap[x][y][z] = 1;
			}
		}
		clearLines();
	}

	function hardDrop() {
		if (!nowBlock || !running) return;
		
		let tempBlock = nowBlock.clone();
		let dropCount = 0;
		const MAX_DROP_STEPS = MAP_HEIGHT;
		
		while (dropCount < MAX_DROP_STEPS) {
			const testBlock = tempBlock.move(5);
			if (checkCollision(testBlock) === 0) {
				tempBlock = testBlock;
				dropCount++;
			} else {
				break;
			}
		}
		
		placeBlock(tempBlock);
		nowBlock = nextBlock;
		nextBlock = createNewBlock();
		
		if (gameConfig.showGhost) {
			ghostBlock = calculateGhostBlock(nowBlock);
		}
		
		if (checkCollision(nowBlock) !== 0) {
			alert(`游戏结束!\n得分: ${score}\n行数: ${lines}`);
			running = false;
			paused = false;
			pauseHint.style.display = 'none';
		}
		
		lastDropTime = Date.now();
	}
	
	function togglePause() {
		if (!running) return;
		paused = !paused;
		if (!paused) {
			lastDropTime = Date.now();
			pauseHint.style.display = 'none';
			if (gameConfig.showGhost) {
				ghostBlock = calculateGhostBlock(nowBlock);
			}
		} else {
			pauseHint.style.display = 'flex';
		}
	}

	function startGame() {
		if (startOverlay) startOverlay.style.display = 'none';
		running = true;
		paused = false;
		lastDropTime = Date.now();
		score = 0;
		lines = 0;
		level = 1;
		currentDropInterval = gameConfig.dropInterval;
		pauseHint.style.display = 'none';
		updateUI();
		if (gameConfig.showGhost) {
			ghostBlock = calculateGhostBlock(nowBlock);
		}
	}

	function restartGame() {
		resetMap();
		score = 0;
		lines = 0;
		level = 1;
		currentDropInterval = gameConfig.dropInterval;
		nowBlock = createNewBlock();
		nextBlock = createNewBlock();
		if (gameConfig.showGhost) {
			ghostBlock = calculateGhostBlock(nowBlock);
		}
		running = true;
		paused = false;
		lastDropTime = Date.now();
		if (startOverlay) startOverlay.style.display = 'none';
		pauseHint.style.display = 'none';
		if (checkCollision(nowBlock) !== 0) {
			alert('Game Over!');
			running = false;
		}
		updateUI();
	}

	if (startBtn) startBtn.addEventListener('click', startGame, false);
	if (restartBtn) restartBtn.addEventListener('click', restartGame, false);

	resetMap();
	nowBlock = createNewBlock();
	nextBlock = createNewBlock();
	if (gameConfig.showGhost) {
		ghostBlock = calculateGhostBlock(nowBlock);
	}

	const gridHelper = new THREE.GridHelper(MAP_WIDTH, MAP_WIDTH, 0x4488aa, 0x335566);
	gridHelper.position.set(MAP_WIDTH/2, -0.1, MAP_WIDTH/2);
	scene.add(gridHelper);
	
	const axesHelper = new THREE.AxesHelper(MAP_HEIGHT + 2);
	axesHelper.material.transparent = true;
	axesHelper.material.opacity = 0.15;
	scene.add(axesHelper);

	function onPointerDown(event) {
		isDragging = true;
		const clientX = event.clientX ?? (event.touches ? event.touches[0].clientX : 0);
		dragStartX = clientX;
		dragAzimuth = azimuth;
	}

	function onPointerMove(event) {
		if (!isDragging) return;
		const clientX = event.clientX ?? (event.touches ? event.touches[0].clientX : 0);
		const deltaX = clientX - dragStartX;
		azimuth = dragAzimuth + deltaX * 0.5;
	}

	function onPointerUp() {
		isDragging = false;
	}

	window.addEventListener('mousedown', onPointerDown);
	window.addEventListener('mousemove', onPointerMove);
	window.addEventListener('mouseup', onPointerUp);
	window.addEventListener('touchstart', onPointerDown);
	window.addEventListener('touchmove', onPointerMove);
	window.addEventListener('touchend', onPointerUp);

	// 键盘控制
	window.addEventListener('keydown', (event) => {
		const code = event.code;
		
		if (code === 'Enter') {
			event.preventDefault();
			togglePause();
			return;
		}
		
		if (code === 'KeyC') {
			event.preventDefault();
			changeShape();
			return;
		}
		
		if (!nowBlock || !running) return;
		
		switch (code) {
			case 'ArrowUp':
				event.preventDefault();
				moveCameraRelative('forward');
				break;
			case 'ArrowDown':
				event.preventDefault();
				moveCameraRelative('backward');
				break;
			case 'ArrowLeft':
				event.preventDefault();
				moveCameraRelative('left');
				break;
			case 'ArrowRight':
				event.preventDefault();
				moveCameraRelative('right');
				break;
			case 'Space':
			case 'Spacebar':
				event.preventDefault();
				hardDrop();
				break;
			case 'KeyQ':
				event.preventDefault();
				rotateBlock('X', true);
				break;
			case 'KeyW':
				event.preventDefault();
				rotateBlock('X', false);
				break;
			case 'KeyE':
				event.preventDefault();
				rotateBlock('Y', true);
				break;
			case 'KeyR':
				event.preventDefault();
				rotateBlock('Y', false);
				break;
			case 'KeyT':
				event.preventDefault();
				rotateBlock('Z', true);
				break;
			case 'KeyY':
				event.preventDefault();
				rotateBlock('Z', false);
				break;
		}
	});

	let lastRenderTime = 0;
	const TARGET_FPS = 60;
	const FRAME_INTERVAL = 1000 / TARGET_FPS;
	
	function animate(currentTime = 0) {
		requestAnimationFrame(animate);
		
		if (currentTime - lastRenderTime < FRAME_INTERVAL) return;
		lastRenderTime = currentTime;
		
		updateCamera();
		
		if (!running || paused) {
			drawAllBlocks();
			renderer.render(scene, camera);
			return;
		}
		
		if (nowBlock && Date.now() - lastDropTime > currentDropInterval) {
			const newBlock = nowBlock.move(5);
			if (checkCollision(newBlock) === 0) {
				nowBlock = newBlock;
				if (gameConfig.showGhost) {
					ghostBlock = calculateGhostBlock(nowBlock);
				}
			} else {
				placeBlock(nowBlock);
				nowBlock = nextBlock;
				nextBlock = createNewBlock();
				if (gameConfig.showGhost) {
					ghostBlock = calculateGhostBlock(nowBlock);
				}
				if (checkCollision(nowBlock) !== 0) {
					alert(`游戏结束!\n得分: ${score}\n行数: ${lines}`);
					running = false;
					paused = false;
					pauseHint.style.display = 'none';
				}
			}
			lastDropTime = Date.now();
		}
		
		drawAllBlocks();
		renderer.render(scene, camera);
	}
	
	animate();
})();