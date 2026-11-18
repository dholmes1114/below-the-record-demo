// =============================================================================
// WHAT THIS FILE IS
//   Everything that only happens in the headset: starting and ending the VR
//   session, the pointing rays from the controllers, and the buttons.
//
// HOW TO READ IT
//   On a screen the sky is about 35 units across and the camera flies around
//   it. In VR you can't fly a person around, so `onSessionStart` shrinks the
//   whole constellation to room size and sets it 3.2 m away, like a mural. The reading board is placed once, about 35 degrees to the right,
//   and then stays put in the room (it does not follow your head).
//
//   Buttons:  trigger = choose what the ray points at (empty sky closes the board)
//             A or X, right grip, stick right = next tour stop
//             B or Y, left grip,  stick left  = previous tour stop
// =============================================================================
import * as THREE from 'three';
import { pickId, PALETTE } from './sky.js';

const rad = THREE.MathUtils.degToRad;
const VR_SCALE = 0.092; // sky units to metres
// Bearings are measured from straight ahead when VR starts: minus is to your left, plus to your right.
// The chart sits a little left and the reading board a little right, like the desktop layout,
// so both are inside the sharp middle of the headset's view at once.
const SKY_BEARING = rad(-19);
const SKY_DISTANCE = 3.2; // metres to the center star
const SKY_HEIGHT = 1.5; // metres above the floor
const PANEL_BEARING = rad(35);
const PANEL_DISTANCE = 1.3; // metres from you to the reading board
const VR_CENTER = new THREE.Vector3(Math.sin(SKY_BEARING) * SKY_DISTANCE, SKY_HEIGHT, -Math.cos(SKY_BEARING) * SKY_DISTANCE);
const PANEL_ANGLE = PANEL_BEARING - SKY_BEARING; // how far right of the chart the board stands
const RAY_LENGTH = 6;
// Sharpness. Headsets normally render the edges of the view at lower resolution to save power ("foveation").
// That blurs text that is not dead centre, so it is turned off here: 0 = sharp everywhere, 1 = most blur at the edges.
const VR_FOVEATION = 0;
// How many pixels the headset draws, relative to its default. 1.2 is a little sharper for text and this scene is light.
// If the picture stutters in the headset, set it back to 1.
const VR_RESOLUTION = 1.2;
// Label size in the headset. At 1.1, a line of a school's name card is about 1.6 degrees tall from where
// you stand. Raise it (1.2, 1.3) if the labels feel small; much higher and the cards reach the reading board.
const VR_LABEL_SCALE = 1.1;

export function setupXR({ renderer, scene, sky, vrPanel, handlers }) {
  const root = sky.root;
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const head = new THREE.Vector3();
  const placedFrom = new THREE.Vector3();
  let saved = null;
  let needsPlacement = false;
  let framesWaited = 0;
  const pressed = new Map(); // remembers which buttons were down last frame, so a held button counts once
  renderer.xr.setFoveation(VR_FOVEATION);
  renderer.xr.setFramebufferScaleFactor(VR_RESOLUTION);

  // ---- controllers -------------------------------------------------------
  const controllers = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: PALETTE.ring, transparent: true, opacity: 0.75 }),
    );
    ray.scale.z = RAY_LENGTH;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: PALETTE.ring }));
    dot.visible = false;
    c.add(ray, dot);
    c.userData = { ray, dot, hand: 'none', hit: null };
    c.addEventListener('connected', (e) => { c.userData.hand = e.data?.handedness ?? 'none'; c.userData.bare = Boolean(e.data?.hand); }); // bare = a tracked hand, no controller
    c.addEventListener('disconnected', () => { letGo(); c.userData.hand = 'none'; c.userData.hit = null; }); // a hand that drops out lets go of what it held
    c.addEventListener('select', () => {
      if (c.userData.bare && c.userData.grabbed) return; // the end of a pinch-and-hold, not a tap
      const hit = c.userData.hit;
      if (hit?.id) handlers.select(hit.id);
      else if (hit?.panel) handlers.board?.(hit.uv); // a trigger pull on the reading board: an optional feature (the rooms) may use it
      else handlers.close();
    });
    c.addEventListener('squeezestart', () => {
      // An optional feature ("chart it") may take a squeeze that lands on a star. Otherwise the grips step the tour.
      const id = c.userData.hit?.id;
      if (id && handlers.grab?.(id)) { c.userData.grabbed = id; return; }
      if (c.userData.hand === 'left') handlers.prev(); else handlers.next();
    });
    const letGo = () => {
      if (c.userData.grabbed) handlers.release?.(c.userData.grabbed);
      c.userData.grabbed = null;
      c.userData.pinch = null;
    };
    c.addEventListener('squeezeend', letGo);
    // Bare hands have no grip, so pinching a star and holding is the squeeze (see `update`).
    c.addEventListener('selectstart', () => {
      const id = c.userData.hit?.id;
      if (c.userData.bare && id) c.userData.pinch = { id, at: performance.now() };
    });
    c.addEventListener('selectend', () => { if (c.userData.bare) letGo(); });
    scene.add(c);
    return c;
  });

  // ---- session start and end ---------------------------------------------
  renderer.xr.addEventListener('sessionstart', () => {
    saved = { position: root.position.clone(), rotation: root.rotation.clone(), scale: root.scale.x };
    root.position.copy(VR_CENTER);
    root.rotation.set(0, -SKY_BEARING, 0); // turn the chart to face you
    root.scale.setScalar(VR_SCALE);
    sky.setLabelScale(VR_LABEL_SCALE);
    scene.add(vrPanel.mesh);
    needsPlacement = true;
    framesWaited = 0;
    pressed.clear();
    handlers.started();
  });
  renderer.xr.addEventListener('sessionend', () => {
    if (saved) {
      root.position.copy(saved.position);
      root.rotation.copy(saved.rotation);
      root.scale.setScalar(saved.scale);
    }
    sky.setLabelScale(1);
    sky.setHover(null);
    vrPanel.hide();
    scene.remove(vrPanel.mesh);
    handlers.ended();
  });

  /** Stand the reading board to the right of the constellation (35 degrees right of straight ahead), facing the reader. */
  function placePanel() {
    head.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    const toSky = new THREE.Vector3(VR_CENTER.x - head.x, 0, VR_CENTER.z - head.z);
    if (toSky.lengthSq() < 0.01) toSky.set(0, 0, -1);
    toSky.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -PANEL_ANGLE);
    const m = vrPanel.mesh;
    m.position.set(head.x + toSky.x * PANEL_DISTANCE, head.y - 0.12, head.z + toSky.z * PANEL_DISTANCE);
    m.lookAt(head.x, m.position.y, head.z);
    placedFrom.copy(head);
    needsPlacement = false;
  }

  /** Called every frame while in VR: aim the rays, work out what each points at, read the buttons. */
  function update() {
    const session = renderer.xr.getSession();
    if (!session) return;

    // Wait for the headset to report where the head is before placing the board.
    head.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    if (needsPlacement && (head.lengthSq() > 0.01 || ++framesWaited > 30)) placePanel();
    // If the reader has walked well away from where the board was set up, bring it back to them.
    else if (!needsPlacement && Math.hypot(head.x - placedFrom.x, head.z - placedFrom.z) > 0.8) placePanel();

    let hover = null;
    for (const c of controllers) {
      const { ray, dot, pinch } = c.userData;
      if (pinch && !c.userData.grabbed && performance.now() - pinch.at > 350) { // a pinch held for a third of a second
        if (handlers.grab?.(pinch.id)) c.userData.grabbed = pinch.id;
        c.userData.pinch = null;
      }
      c.userData.hit = null;
      if (!c.visible) continue;
      rotation.identity().extractRotation(c.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
      const panelHit = vrPanel.mesh.visible ? raycaster.intersectObject(vrPanel.mesh, false)[0] : null;
      const hits = raycaster.intersectObjects(sky.colliders, false);
      const id = pickId(hits);
      let length = RAY_LENGTH;
      if (panelHit && (!hits.length || panelHit.distance < hits[0].distance)) {
        c.userData.hit = { panel: true, uv: panelHit.uv };
        length = panelHit.distance;
      } else if (id) {
        c.userData.hit = { id };
        length = hits.find((h) => h.object.userData.id === id).distance;
        hover = hover ?? id;
      }
      ray.scale.z = length;
      dot.visible = Boolean(c.userData.hit);
      dot.position.set(0, 0, -length);
    }
    sky.setHover(hover);

    // Face buttons and thumbsticks have no events, so check them each frame and act on the moment they go down.
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      if (!pad) continue;
      const edge = (name, down) => {
        const key = `${source.handedness}:${name}`;
        const was = pressed.get(key) || false;
        pressed.set(key, down);
        return down && !was;
      };
      if (edge('a', Boolean(pad.buttons[4]?.pressed))) handlers.next();
      if (edge('b', Boolean(pad.buttons[5]?.pressed))) handlers.prev();
      const x = pad.axes.length >= 4 ? pad.axes[2] : 0;
      if (edge('right', x > 0.75)) handlers.next();
      if (edge('left', x < -0.75)) handlers.prev();
      // Pushing the stick up is spare: an optional feature (dark matter) may listen for it.
      const y = pad.axes.length >= 4 ? pad.axes[3] : 0;
      if (edge('up', y < -0.75)) handlers.up?.();
    }
  }

  // ---- the Enter VR button ------------------------------------------------
  async function isSupported() {
    try {
      return Boolean(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
    } catch {
      return false;
    }
  }
  async function toggle() {
    const current = renderer.xr.getSession();
    if (current) return current.end();
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await renderer.xr.setSession(session);
  }

  return {
    isSupported,
    toggle,
    update,
    get presenting() { return renderer.xr.isPresenting; },
    requestPlacement() { needsPlacement = true; framesWaited = 0; },
    /** For checking the layout: where the chart and the board are, in degrees right of straight ahead and metres away. */
    measure() {
      const h = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
      const bearing = (p) => ({
        degrees: Math.round(THREE.MathUtils.radToDeg(Math.atan2(p.x - h.x, -(p.z - h.z))) * 10) / 10,
        metres: Math.round(Math.hypot(p.x - h.x, p.z - h.z) * 100) / 100,
      });
      return { chart: bearing(root.position), board: bearing(vrPanel.mesh.position), foveation: renderer.xr.getFoveation() };
    },
  };
}
