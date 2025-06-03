import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, player, playerMixer, playerAnimations = {}, currentAnimationState = 'idle';
let moveDirection = new THREE.Vector3(), moveSpeed = 0.1, clock = new THREE.Clock(), cameraTargetOffset = new THREE.Vector3(0, 2, 5);
let npcs = [], currentNPC = null;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isJumping = false, yVelocity = 0, gravity = -9.8;

const npcDialogueDiv = document.getElementById('npc-dialogue');
const popupContainer = document.getElementById('popup-container');
const popupContentDiv = document.getElementById('popup-content');

let worldModel, gymNpc, learnNpc, portfolioNpc;

init();
animate();

function init() {
    const canvas = document.querySelector('#c');

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    scene.background = new THREE.Color('white');
    camera.position.set(0, 5, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const gltfLoader = new GLTFLoader();
    gltfLoader.load('./assets/models/port_world.glb', function (gltf) {
        worldModel = gltf.scene;
        worldModel.position.set(0, 0, 0);
        scene.add(worldModel);
        console.log("World model loaded:", worldModel);
    }, undefined, function (error) {
        console.error("An error happened loading the world model:", error);
    });

    fetch('./data/locations.json')
        .then(response => response.json())
        .then(locationsData => {
            const npcPaths = locationsData.map(location => ({
                name: location.npcName,
                path: `./assets/models/${location.npcName}.glb`,
                position: getNpcPosition(location.npcName),
                dataFile: location.dataFile,
                popupTitle: location.popupTitle
            }));

            npcPaths.forEach(npcInfo => {
                gltfLoader.load(npcInfo.path, function (gltf) {
                    const model = gltf.scene;
                    model.position.set(npcInfo.position.x, npcInfo.position.y, npcInfo.position.z);
                    scene.add(model);

                    if (npcInfo.name === 'gym_npc') gymNpc = model;
                    if (npcInfo.name === 'learn_npc') learnNpc = model;
                    if (npcInfo.name === 'portfolio_npc') portfolioNpc = model;
                    npcs.push({ model: model, name: npcInfo.name, dataFile: npcInfo.dataFile, popupTitle: npcInfo.popupTitle });
                }, undefined, function (error) {
                    console.error(`Error loading NPC model: ${npcInfo.name}`, error);
                });
            });
        })
        .catch(error => console.error("Error loading locations.json:", error));

    gltfLoader.load('./assets/models/character.glb', function (gltf) {
        player = gltf.scene;
        player.position.set(0, 0, 0);
        scene.add(player);
        console.log("player model loaded:", player);

        playerMixer = new THREE.AnimationMixer(player);

        if (gltf.animations && gltf.animations.length > 0) {
            const idleAnim = gltf.animations.find(anim => anim.name === 'idle');
            const walkAnim = gltf.animations.find(anim => anim.name === 'walk');
            const jumpAnim = gltf.animations.find(anim => anim.name === 'jump');

            if (idleAnim) playerAnimations['idle'] = playerMixer.clipAction(idleAnim);
            if (walkAnim) playerAnimations['walk'] = playerMixer.clipAction(walkAnim);
            if (jumpAnim) playerAnimations['jump'] = playerMixer.clipAction(jumpAnim);

            if (playerAnimations['idle']) {
                playerAnimations['idle'].play();
                currentAnimationState = 'idle';
            }
        } else {
            console.warn("No animations found in the player model.");
        }

    }, undefined, function (error) {
        console.error("Error loading player character:", error);
    });

    const ambientLight = new THREE.AmbientLight(0x404040, 10);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('click', onDocumentMouseDown, false);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (playerMixer) playerMixer.update(delta);

    updatePlayerMovement(delta);
    updateCameraPosition();
    checkNPCInteraction();
    renderer.render(scene, camera);
}

function updatePlayerMovement(deltaTime) {
    moveDirection.set(0, 0, 0);
    if (moveForward) moveDirection.z -= 1;
    if (moveBackward) moveDirection.z += 1;
    if (moveLeft) moveDirection.x -= 1;
    if (moveRight) moveDirection.x += 1;
    moveDirection.normalize();

    if (moveDirection.lengthSq() > 0) {
        player.translateZ(moveSpeed * moveDirection.z);
        player.translateX(moveSpeed * moveDirection.x);

        if (currentAnimationState !== 'walk' && playerAnimations['walk']) {
            if (playerAnimations['idle']) playerAnimations['idle'].fadeOut(0.2);
            playerAnimations['walk'].reset().fadeIn(0.2).play();
            currentAnimationState = 'walk';
        } else if (moveDirection.lengthSq() === 0 && currentAnimationState === 'walk' && playerAnimations['idle']) {
            playerAnimations['walk'].fadeOut(0.2);
            playerAnimations['idle'].reset().fadeIn(0.2).play();
            currentAnimationState = 'idle';
        }
    } else if (currentAnimationState !== 'idle' && playerAnimations['idle']) {
        if (playerAnimations['walk']) playerAnimations['walk'].fadeOut(0.2);
        playerAnimations['idle'].reset().fadeIn(0.2).play();
        currentAnimationState = 'idle';
    }

    // Jumping logic
    if (isJumping) {
        yVelocity += gravity * deltaTime * 2; // Increased gravity for quicker jump
        player.position.y += yVelocity * deltaTime;

        if (player.position.y < 0) {
            player.position.y = 0;
            isJumping = false;
            yVelocity = 0;
            if (moveDirection.lengthSq() > 0 && playerAnimations['walk']) {
                if (playerAnimations['jump']) playerAnimations['jump'].fadeOut(0.2);
                playerAnimations['walk'].reset().fadeIn(0.2).play();
                currentAnimationState = 'walk';
            } else if (playerAnimations['idle']) {
                if (playerAnimations['jump']) playerAnimations['jump'].fadeOut(0.2);
                playerAnimations['idle'].reset().fadeIn(0.2).play();
                currentAnimationState = 'idle';
            }
        } else if (currentAnimationState !== 'jump' && playerAnimations['jump']) {
            if (playerAnimations['idle']) playerAnimations['idle'].fadeOut(0.2);
            if (playerAnimations['walk']) playerAnimations['walk'].fadeOut(0.2);
            playerAnimations['jump'].reset().fadeIn(0.2).play();
            currentAnimationState = 'jump';
        }
    } else if (moveDirection.lengthSq() > 0 && currentAnimationState !== 'walk' && playerAnimations['walk']) {
        if (playerAnimations['idle']) playerAnimations['idle'].fadeOut(0.2);
        playerAnimations['walk'].reset().fadeIn(0.2).play();
        currentAnimationState = 'walk';
    } else if (moveDirection.lengthSq() === 0 && currentAnimationState !== 'idle' && playerAnimations['idle']) {
        if (playerAnimations['walk']) playerAnimations['walk'].fadeOut(0.2);
        playerAnimations['idle'].reset().fadeIn(0.2).play();
        currentAnimationState = 'idle';
    }
}

window.hidePopup = function() {
    popupContainer.style.display = 'none';
    popupContentDiv.innerHTML = '';
};

function updateCameraPosition() {
    if (!player) return;
    camera.position.copy(player.position).add(cameraTargetOffset);
    camera.lookAt(player.position);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function checkNPCInteraction() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(npcs.map(npc => npc.model), true);

    if (intersects.length > 0) {
        const firstIntersectedObject = intersects[0].object;
        const intersectedNPC = npcs.find(npcData => firstIntersectedObject.isDescendantOf(npcData.model));

        if (intersectedNPC && intersectedNPC !== currentNPC) {
            currentNPC = intersectedNPC;
            showNPCDialogue(`Hello! Welcome to the ${intersectedNPC.popupTitle} area. Do you want to enter?`, intersectedNPC);
        }
    } else if (currentNPC) {
        hideNPCDialogue();
        currentNPC = null;
    }
}

function showNPCDialogue(message, npc) {
    npcDialogueDiv.textContent = message;
    npcDialogueDiv.style.display = 'block';
    npcDialogueDiv.dataset.npcName = npc.name;
}

function hideNPCDialogue() {
    npcDialogueDiv.style.display = 'none';
    npcDialogueDiv.dataset.npcName = '';
}

function onDocumentMouseDown(event) {
    if (currentNPC) showPopup(currentNPC.dataFile, currentNPC.popupTitle);
}

function showPopup(dataFile, popupTitle) {
    popupContainer.style.display = 'flex';
    popupContentDiv.innerHTML = `<h2>${popupTitle}</h2><p>Loading data...</p>`;

    fetch(dataFile)
        .then(response => response.json())
        .then(data => {
            let contentHTML = `<h2>${popupTitle}</h2><ul>`;
            if (popupTitle === 'Skills') {
                contentHTML += "<h3>Programming Languages:</h3><ul>";
                data.programmingLanguages.forEach(skill => contentHTML += `<li>${skill}</li>`);
                contentHTML += "</ul><h3>Currently Learning:</h3><ul>";
                data.currentlyLearning.forEach(skill => contentHTML += `<li>${skill}</li>`);
                contentHTML += "</ul>";
            } else if (popupTitle === 'Projects') {
                data.projects.forEach(project => {
                    contentHTML += `<li><strong>${project.title}</strong> - ${project.description} (Technologies: ${project.technologies.join(', ')})</li>`;
                });
            } else if (popupTitle === 'Resume') {
                contentHTML += "<h3>Teaching History:</h3><ul>";
                data.teachingHistory.forEach(item => contentHTML += `<li>${item.role} at ${item.institution} - ${item.description}</li>`);
                contentHTML += "</ul>";
            }
            contentHTML += `</ul>`;
            popupContentDiv.innerHTML = contentHTML;
        })
        .catch(error => {
            console.error("Error loading data:", error);
            popupContentDiv.innerHTML = `<p>Error loading data.</p>`;
        });
}

function hidePopup() {
    popupContainer.style.display = 'none';
    popupContentDiv.innerHTML = '';
}

//Switching between players actions
function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            break;
        case 'Space':
            if (!isJumping) { // Add a check to prevent multi-jumping
                isJumping = true;
                yVelocity = 5;  // Set initial upward velocity
                // You might also want to trigger an animation here
            }
            break;
    }
    //console.log("Key Down:", event.code, { moveForward, moveBackward, moveLeft, moveRight, isJumping }); //For Debug
}

function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
    }
     //console.log("Key Up:", event.code, { moveForward, moveBackward, moveLeft, moveRight }); //For Debug
}


function getNpcPosition(npcName) {
    switch (npcName) {
        case 'gymNpc':
            return { x: 5, y: 0, z: 0 };
        case 'learnNpc':
            return { x: -5, y: 0, z: 0 };
        case 'portfolioNpc':
            return { x: 0, y: 0, z: 5 };
        default:
            return { x: 0, y: 0, z: 0 };
    }
}