import WindowManager from './WindowManager.js'

const t = THREE;
let camera, scene, renderer, world;
let pixR = window.devicePixelRatio ? window.devicePixelRatio : 1;
let cubes = [];
let sceneOffsetTarget = {x: 0, y: 0};
let sceneOffset = {x: 0, y: 0};

let today = new Date();
today.setHours(0, 0, 0, 0);
today = today.getTime();

let internalTime = getTime();
let windowManager;
let initialized = false;

// 성능 최적화: 파티클 수 동적 조절
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const PARTICLE_COUNTS = {
	single: isMobile ? 15000 : 30000,
	outerMulti: isMobile ? 25000 : 50000,
	innerMulti: isMobile ? 8000 : 16000
};

// Object Pool for spheres
const spherePool = [];
const MAX_POOL_SIZE = 10;

function getTime() {
	return (new Date().getTime() - today) / 1000.0;
}

if (new URLSearchParams(window.location.search).get("clear")) {
	// localStorage 사용 제거 - WindowManager에서 처리
	console.log("Clear flag detected");
} else {	
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState != 'hidden' && !initialized) {
			init();
		}
	});

	window.onload = () => {
		if (document.visibilityState != 'hidden') {
			init();
		}
	};
	
	function init() {
		initialized = true;
		setTimeout(() => {
			setupScene();
			setupWindowManager();
			resize();
			updateWindowShape(false);
			render();
			window.addEventListener('resize', resize);
		}, 500);	
	}
	
	function setupScene() {
		camera = new t.OrthographicCamera(0, 0, window.innerWidth, window.innerHeight, -10000, 10000);
		camera.position.z = 5.0;

		scene = new t.Scene();
		scene.background = new t.Color(0.0);
		scene.add(camera);
	
		renderer = new t.WebGLRenderer({
			antialias: true, 
			depthBuffer: true,
			powerPreference: "high-performance" // GPU 우선 사용
		});
		renderer.setPixelRatio(Math.min(pixR, 2)); // 최대 2로 제한
		
		world = new t.Object3D();
		scene.add(world);
	
		renderer.domElement.setAttribute("id", "scene");
		document.body.appendChild(renderer.domElement);

		const light = new THREE.AmbientLight(0x404040);
		scene.add(light);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
		directionalLight.position.set(0, 128, 128);
		scene.add(directionalLight);
	}
	
	function setupWindowManager() {
		windowManager = new WindowManager();
		windowManager.setWinShapeChangeCallback(updateWindowShape);
		windowManager.setWinChangeCallback(windowsUpdated);

		let metaData = {foo: "bar"};
		windowManager.init(metaData);
		windowsUpdated();
	}
	
	function windowsUpdated() {
		updateNumberOfCubes();
	}
	
	// 최적화된 3D 노이즈 (결과 캐싱 가능하도록 수정)
	const noiseCache = new Map();
	function noise3D(x, y, z) {
		const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
		if (noiseCache.has(key)) return noiseCache.get(key);
		
		const X = Math.floor(x) & 255;
		const Y = Math.floor(y) & 255;
		const Z = Math.floor(z) & 255;
		
		x -= Math.floor(x);
		y -= Math.floor(y);
		z -= Math.floor(z);
		
		const u = fade(x);
		const v = fade(y);
		const w = fade(z);
		
		const A = (X + Y + Z) % 256;
		const B = (X + Y + Z + 1) % 256;
		
		const result = lerp(w, 
			lerp(v, lerp(u, grad(A, x, y, z), grad(B, x-1, y, z)),
			        lerp(u, grad(A+1, x, y-1, z), grad(B+1, x-1, y-1, z))),
			lerp(v, lerp(u, grad(A+1, x, y, z-1), grad(B+1, x-1, y, z-1)),
			        lerp(u, grad(A+2, x, y-1, z-1), grad(B+2, x-1, y-1, z-1))));
		
		if (noiseCache.size < 10000) noiseCache.set(key, result);
		return result;
	}
	
	function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
	function lerp(t, a, b) { return a + t * (b - a); }
	function grad(hash, x, y, z) {
		const h = hash & 15;
		const u = h < 8 ? x : y;
		const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
		return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
	}
	
	function recycleSphere(sphere) {
		if (spherePool.length < MAX_POOL_SIZE) {
			sphere.visible = false;
			spherePool.push(sphere);
		} else {
			sphere.children.forEach(child => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) child.material.dispose();
			});
		}
	}
	
	function updateNumberOfCubes() {
		let wins = windowManager.getWindows();

		// 기존 구체 회수
		cubes.forEach((c) => {
			world.remove(c);
			recycleSphere(c);
		});
		cubes = [];

		if (wins.length === 1) {
			let win = wins[0];
			let c = new t.Color('hsl(140, 100%, 50%)');
			let s = 500;
			let radius = s / 2;

			let sphere = createSingleSphere(radius, c, 0);
			sphere.position.x = win.shape.x + (win.shape.w * .5);
			sphere.position.y = win.shape.y + (win.shape.h * .5);
			
			sphere.userData.velocity = {x: 0, y: 0};
			sphere.userData.lastPos = {x: sphere.position.x, y: sphere.position.y};
			sphere.userData.windowIndex = 0;

			world.add(sphere);
			cubes.push(sphere);
		} else {
			for (let i = 0; i < wins.length; i++) {
				let win = wins[i];
				let s = 500;
				let radius = s / 2;

				let sphere = createDoubleSphere(radius, i, wins.length);
				sphere.position.x = win.shape.x + (win.shape.w * .5);
				sphere.position.y = win.shape.y + (win.shape.h * .5);
				
				sphere.userData.velocity = {x: 0, y: 0};
				sphere.userData.lastPos = {x: sphere.position.x, y: sphere.position.y};
				sphere.userData.windowIndex = i;

				world.add(sphere);
				cubes.push(sphere);
			}
		}
	}
	
	function createSingleSphere(radius, color, seed) {
		let complexSphere = new THREE.Group();
		let particlesOuter = createContinentParticles(radius, color, PARTICLE_COUNTS.single, seed, false);
		complexSphere.add(particlesOuter);
		return complexSphere;
	}
	
	function createDoubleSphere(radius, currentIndex, totalWindows) {
		let complexSphere = new THREE.Group();
		
		let isGreen = currentIndex % 2 === 0;
		let outerColor = isGreen ? new t.Color('hsl(140, 100%, 50%)') : new t.Color('hsl(0, 100%, 40%)');
		
		let particlesOuter = createContinentParticles(radius, outerColor, PARTICLE_COUNTS.outerMulti, currentIndex);
		complexSphere.add(particlesOuter);
		
		for (let i = 0; i < totalWindows; i++) {
			if (i !== currentIndex) {
				let otherIsGreen = i % 2 === 0;
				let innerColor = otherIsGreen ? new t.Color('hsl(140, 100%, 50%)') : new t.Color('hsl(0, 100%, 40%)');
				let innerSize = radius * 0.6;
				let particlesInner = createContinentParticles(innerSize, innerColor, PARTICLE_COUNTS.innerMulti, i);
				complexSphere.add(particlesInner);
			}
		}
		
		return complexSphere;
	}
	
	// BufferGeometry로 전환 (핵심 최적화)
	function createContinentParticles(size, color, count, seed, isInner = false) {
		const positions = [];
		const velocities = [];
		
		const scale = 1.0;
		const continentThreshold = 0.2;
		const backgroundRatio = 0.3;
		const continentDensityMultiplier = 5;
		const flareRatio = 0.3;
		
		let backgroundCount = Math.floor(count * backgroundRatio);
		let flareCount = Math.floor(count * flareRatio);
		let continentBudget = count - backgroundCount - flareCount;
		
		// 대륙 파티클
		let attempts = 0;
		const maxAttempts = continentBudget * continentDensityMultiplier;
		let continentPoints = 0;
		
		while (continentPoints < continentBudget * continentDensityMultiplier && attempts < maxAttempts) {
			attempts++;
			
			let theta = Math.random() * Math.PI * 2;
			let phi = Math.acos(2 * Math.random() - 1);
			
			let x = Math.sin(phi) * Math.cos(theta);
			let y = Math.sin(phi) * Math.sin(theta);
			let z = Math.cos(phi);
			
			let noiseValue = noise3D(x * scale + seed * 10, y * scale + seed * 10, z * scale + seed * 10);
			noiseValue += noise3D(x * scale * 2 + seed * 10, y * scale * 2 + seed * 10, z * scale * 2 + seed * 10) * 0.5;
			
			if (noiseValue > continentThreshold) {
				let density = Math.max(0, (noiseValue - continentThreshold) / 0.1);
				
				if (Math.random() < density * 0.9 + 0.1) {
					let altitudeVariation = 0.98 + Math.random() * 0.1;
					
					positions.push(
						x * size * altitudeVariation,
						y * size * altitudeVariation,
						z * size * altitudeVariation
					);
					velocities.push(0, 0, 0);
					continentPoints++;
				}
			}
		}
		
		// 플레어 파티클
		let flareStreaks = Math.floor(flareCount / 6);
		for (let streak = 0; streak < flareStreaks; streak++) {
			let theta = Math.random() * Math.PI * 2;
			let phi = Math.acos(2 * Math.random() - 1);
	
			let x = Math.sin(phi) * Math.cos(theta);
			let y = Math.sin(phi) * Math.sin(theta);
			let z = Math.cos(phi);
			
			let noiseValue = noise3D(x * scale + seed * 10, y * scale + seed * 10, z * scale + seed * 10);
			noiseValue += noise3D(x * scale * 2 + seed * 10, y * scale * 2 + seed * 10, z * scale * 2 + seed * 10) * 0.5;
	
			if (noiseValue > continentThreshold) {
				let density = Math.max(0, (noiseValue - continentThreshold) / 0.1);
				let streakLength = Math.floor(5 + density * 5);
				
				for (let step = 0; step < streakLength; step++) {
					let distance = 1.05 + step * 0.02;
					let randomOffset = 0.98 + Math.random() * 0.04;
					
					positions.push(
						x * size * distance * randomOffset,
						y * size * distance * randomOffset,
						z * size * distance * randomOffset
					);
					velocities.push(0, 0, 0);
				}
			}
		}	
		
		// 배경 파티클
		for (let i = 0; i < backgroundCount; i++) {
			let theta = Math.random() * Math.PI * 2;
			let phi = Math.acos(2 * Math.random() - 1);
			let altitudeVariation = 0.96 + Math.random() * 0.08;
			
			positions.push(
				Math.sin(phi) * Math.cos(theta) * size * altitudeVariation,
				Math.sin(phi) * Math.sin(theta) * size * altitudeVariation,
				Math.cos(phi) * size * altitudeVariation
			);
			velocities.push(0, 0, 0);
		}
		
		// BufferGeometry 생성
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
		
		// 원본 위치 저장
		const originalPositions = new Float32Array(positions);
		geometry.setAttribute('originalPosition', new THREE.BufferAttribute(originalPositions, 3));
		
		const material = new THREE.PointsMaterial({
			size: 1.2,
			color: color,
			transparent: true,
			opacity: 0.4,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		
		const points = new THREE.Points(geometry, material);
		points.userData.isInner = isInner; // 내부 구체 표시
		return points;
	}
	
	// 연결 파티클 생성 (외부에서 내부로 빨려들어가는 효과)
	function createConnectionParticles(outerRadius, innerRadius, outerColor, innerColor) {
		const positions = [];
		const velocities = [];
		const progress = []; // 각 파티클의 진행도 (0~1)
		const streamIds = []; // 어느 스트림에 속하는지
		
		const streamCount = isMobile ? 8 : 15; // 빨려들어가는 줄기 개수
		const particlesPerStream = isMobile ? 30 : 60; // 각 줄기당 파티클 수
		
		for (let streamId = 0; streamId < streamCount; streamId++) {
			// 외부 구체의 랜덤한 시작점
			let theta = Math.random() * Math.PI * 2;
			let phi = Math.acos(2 * Math.random() - 1);
			
			let startX = Math.sin(phi) * Math.cos(theta);
			let startY = Math.sin(phi) * Math.sin(theta);
			let startZ = Math.cos(phi);
			
			// 내부 구체의 랜덤한 도착점 (다른 각도)
			theta = Math.random() * Math.PI * 2;
			phi = Math.acos(2 * Math.random() - 1);
			
			let endX = Math.sin(phi) * Math.cos(theta);
			let endY = Math.sin(phi) * Math.sin(theta);
			let endZ = Math.cos(phi);
			
			// 스트림을 따라 파티클 배치
			for (let i = 0; i < particlesPerStream; i++) {
				let t = i / particlesPerStream; // 0~1
				
				// 나선형 경로 (더 역동적)
				let spiralAngle = t * Math.PI * 4; // 2바퀴 회전
				let spiralRadius = 0.3 * Math.sin(t * Math.PI); // 중간에 부풀어오름
				
				// 기본 선형 보간
				let baseX = startX * outerRadius * (1 - t) + endX * innerRadius * t;
				let baseY = startY * outerRadius * (1 - t) + endY * innerRadius * t;
				let baseZ = startZ * outerRadius * (1 - t) + endZ * innerRadius * t;
				
				// 나선 오프셋 추가
				let perpX = -startY;
				let perpY = startX;
				let perpZ = 0;
				let perpLen = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
				if (perpLen > 0.01) {
					perpX /= perpLen;
					perpY /= perpLen;
					perpZ /= perpLen;
				}
				
				let x = baseX + perpX * spiralRadius * Math.cos(spiralAngle) * outerRadius;
				let y = baseY + perpY * spiralRadius * Math.cos(spiralAngle) * outerRadius;
				let z = baseZ + perpZ * spiralRadius * Math.sin(spiralAngle) * outerRadius;
				
				positions.push(x, y, z);
				velocities.push(0, 0, 0);
				progress.push(t);
				streamIds.push(streamId);
			}
		}
		
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
		geometry.setAttribute('progress', new THREE.Float32BufferAttribute(progress, 1));
		geometry.setAttribute('streamId', new THREE.Float32BufferAttribute(streamIds, 1));
		
		// 색상 그라데이션 (외부색 -> 내부색)
		const colors = [];
		for (let i = 0; i < progress.length; i++) {
			let t = progress[i];
			colors.push(
				outerColor.r * (1 - t) + innerColor.r * t,
				outerColor.g * (1 - t) + innerColor.g * t,
				outerColor.b * (1 - t) + innerColor.b * t
			);
		}
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		
		const material = new THREE.PointsMaterial({
			size: 1.5,
			transparent: true,
			opacity: 0.6,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			vertexColors: true // 각 파티클마다 다른 색상
		});
		
		const points = new THREE.Points(geometry, material);
		points.userData.isConnection = true;
		points.userData.outerRadius = outerRadius;
		points.userData.innerRadius = innerRadius;
		return points;
	}

	function updateWindowShape(easing = true) {
		sceneOffsetTarget = {x: -window.screenX, y: -window.screenY};
		if (!easing) sceneOffset = sceneOffsetTarget;
	}

	function render() {
		let t = getTime();
		windowManager.update();

		let falloff = .05;
		sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
		sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);

		world.position.x = sceneOffset.x;
		world.position.y = sceneOffset.y;

		let wins = windowManager.getWindows();

		for (let i = 0; i < cubes.length; i++) {
			let complexSphere = cubes[i]; 
			let winIndex = complexSphere.userData.windowIndex;
			
			if (winIndex >= wins.length) continue;
			
			let win = wins[winIndex];
			let posTarget = {
				x: win.shape.x + (win.shape.w * .5), 
				y: win.shape.y + (win.shape.h * .5)
			};
			
			let lastPos = complexSphere.userData.lastPos;
			complexSphere.userData.velocity.x = posTarget.x - lastPos.x;
			complexSphere.userData.velocity.y = posTarget.y - lastPos.y;
			
			complexSphere.position.x += (posTarget.x - complexSphere.position.x) * falloff;
        	complexSphere.position.y += (posTarget.y - complexSphere.position.y) * falloff;

			complexSphere.userData.lastPos.x = complexSphere.position.x;
			complexSphere.userData.lastPos.y = complexSphere.position.y;

			complexSphere.rotation.x = t * .5; 
			complexSphere.rotation.y = t * .3; 
			updateComplexSphere(complexSphere, t);
		}

		renderer.render(scene, camera);
		requestAnimationFrame(render);
	}
	
	// BufferGeometry용 업데이트 (로컬 공간에서 처리)
	function updateComplexSphere(complexSphere, elapsedTime) {
		let sphereVel = complexSphere.userData.velocity || {x: 0, y: 0};
		let velocityMag = Math.sqrt(sphereVel.x * sphereVel.x + sphereVel.y * sphereVel.y);
		let radialPush = Math.min(velocityMag * 0.5 + 3, 10);

		for (let layerIndex = 0; layerIndex < complexSphere.children.length; layerIndex++) {
			let particles = complexSphere.children[layerIndex];
			
			// 연결 파티클은 다르게 처리
			if (particles.userData.isConnection) {
				updateConnectionParticles(particles, elapsedTime);
				continue;
			}
			
			particles.rotation.y += 0.0005 * (layerIndex % 2 === 0 ? 1 : -1);

			const positions = particles.geometry.attributes.position.array;
			const velocities = particles.geometry.attributes.velocity.array;
			const originals = particles.geometry.attributes.originalPosition.array;
			const count = positions.length / 3;
			
			// 로컬 공간에서 직접 처리 (행렬 연산 제거)
			for (let i = 0; i < count; i++) {
				const i3 = i * 3;
				
				// 현재 위치
				let x = positions[i3];
				let y = positions[i3 + 1];
				let z = positions[i3 + 2];
				
				// 원본 위치
				let ox = originals[i3];
				let oy = originals[i3 + 1];
				let oz = originals[i3 + 2];
				
				// Wave 효과
				let wave = Math.sin(elapsedTime * 2 + ox * 0.05) * 1.5;
				
				// 관성
				velocities[i3] += sphereVel.x * 0.014;
				velocities[i3 + 1] += sphereVel.y * 0.014;
				
				// 원위치로 복원력
				velocities[i3] += (ox - x) * 0.02;
				velocities[i3 + 1] += (oy - y) * 0.02;
				velocities[i3 + 2] += (oz - z) * 0.02;
				
				// 감쇠
				velocities[i3] *= 0.97;
				velocities[i3 + 1] *= 0.97;
				velocities[i3 + 2] *= 0.97;
				
				// 물방울 효과
				let currentRadius = Math.sqrt(x * x + y * y + z * z);
				let originalRadius = Math.sqrt(ox * ox + oy * oy + oz * oz);
				
				if (currentRadius > 0.01) {
					let invRadius = 1 / currentRadius;
					let dirX = x * invRadius;
					let dirY = y * invRadius;
					let dirZ = z * invRadius;
					
					let pushDirection = -(dirX * sphereVel.x + dirY * sphereVel.y) / Math.max(velocityMag, 0.1);
					let radialOffset = pushDirection * radialPush;
					let targetRadius = originalRadius + radialOffset;
					let radiusDiff = targetRadius - currentRadius;
					
					// 위치 업데이트
					positions[i3] = x + velocities[i3] + dirX * radiusDiff * 0.12;
					positions[i3 + 1] = y + velocities[i3 + 1] + dirY * radiusDiff * 0.12;
					positions[i3 + 2] = z + velocities[i3 + 2] + dirZ * radiusDiff * 0.12;
				}
			}
			
			particles.geometry.attributes.position.needsUpdate = true;
		}
	}
	
	// 연결 파티클 애니메이션 (흐르는 효과)
	function updateConnectionParticles(particles, elapsedTime) {
		const positions = particles.geometry.attributes.position.array;
		const progressAttr = particles.geometry.attributes.progress.array;
		const streamIds = particles.geometry.attributes.streamId.array;
		const count = positions.length / 3;
		
		const outerRadius = particles.userData.outerRadius;
		const innerRadius = particles.userData.innerRadius;
		
		// 시간에 따라 진행도 업데이트 (흐르는 효과)
		const flowSpeed = 0.3; // 흐름 속도
		
		for (let i = 0; i < count; i++) {
			const i3 = i * 3;
			let streamId = streamIds[i];
			
			// 각 스트림마다 약간씩 다른 속도와 위상
			let streamOffset = (streamId * 0.1) % 1.0;
			let t = (progressAttr[i] + elapsedTime * flowSpeed + streamOffset) % 1.0;
			
			// 새로운 시작/끝 점 계산 (원래 경로 유지)
			let originalT = progressAttr[i];
			let seed = streamId * 100; // 각 스트림마다 고유한 시드
			
			// 시작점 재계산
			let theta1 = (seed * 0.1) % (Math.PI * 2);
			let phi1 = Math.acos(2 * ((seed * 0.01) % 1) - 1);
			let startX = Math.sin(phi1) * Math.cos(theta1);
			let startY = Math.sin(phi1) * Math.sin(theta1);
			let startZ = Math.cos(phi1);
			
			// 끝점 재계산
			let theta2 = ((seed + 50) * 0.1) % (Math.PI * 2);
			let phi2 = Math.acos(2 * (((seed + 50) * 0.01) % 1) - 1);
			let endX = Math.sin(phi2) * Math.cos(theta2);
			let endY = Math.sin(phi2) * Math.sin(theta2);
			let endZ = Math.cos(phi2);
			
			// 나선형 경로
			let spiralAngle = t * Math.PI * 4;
			let spiralRadius = 0.3 * Math.sin(t * Math.PI);
			
			let baseX = startX * outerRadius * (1 - t) + endX * innerRadius * t;
			let baseY = startY * outerRadius * (1 - t) + endY * innerRadius * t;
			let baseZ = startZ * outerRadius * (1 - t) + endZ * innerRadius * t;
			
			let perpX = -startY;
			let perpY = startX;
			let perpZ = 0;
			let perpLen = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
			if (perpLen > 0.01) {
				perpX /= perpLen;
				perpY /= perpLen;
				perpZ /= perpLen;
			}
			
			positions[i3] = baseX + perpX * spiralRadius * Math.cos(spiralAngle) * outerRadius;
			positions[i3 + 1] = baseY + perpY * spiralRadius * Math.cos(spiralAngle) * outerRadius;
			positions[i3 + 2] = baseZ + perpZ * spiralRadius * Math.sin(spiralAngle) * outerRadius;
		}
		
		particles.geometry.attributes.position.needsUpdate = true;
	}
	
	function resize() {
		let width = window.innerWidth;
		let height = window.innerHeight;
		
		camera = new t.OrthographicCamera(0, width, 0, height, -10000, 10000);
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
	}
}