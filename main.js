import * as THREE from 'three';

const $ = (s, c = document) => c.querySelector(s);
// Interface strings. Translated pages carry their own in <script id="i18n">; English is the default.
const T = Object.assign({
  view: 'View', openLive: 'Open the live site →',
  status: ['// initialising', '// loading fonts', '// building globe', '// ready'],
}, (() => { try { return JSON.parse(document.getElementById('i18n')?.textContent || '{}'); } catch { return {}; } })());
const CJK = /^zh/.test(document.documentElement.lang);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Scene ---------- */
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { console.warn('WebGL unavailable', e); }

const state = { mouse: new THREE.Vector2(), smooth: new THREE.Vector2(), scroll: 0, smoothScroll: 0, theme: 0 };

// Per-section settings. Colours switch with the section. The layout is a keyframe the globe travels through as you scroll:
//   x, y  = position as a fraction of half the visible width / height (+x right, +y up)
//   r     = radius of the globe body as a fraction of the window's shorter side (>1 = oversized)
//   tilt  = roll of the whole globe (radians)   bleed = 1 lets it run off the window edge, 0 keeps it fully in view
//   my    = vertical position on phones (the globe sits above the text there)
//   g, h, d, n, p = what the particle cloud forms: g = 1 the dotted Earth, h = 1 Victoria Harbour, d = 1 the Arizona desert,
//           n = 1 New York, p = 1 Paris, none = a drifting star field
const THEMES = [
  { a: '#0050ff', b: '#ff2e93', x: 0.66, y: -0.02, r: 1.05, tilt: 0.0,  bleed: 1, g: 1, h: 0, d: 0, n: 0, p: 0, my: 0.6 },   // 0 hero: oversized, bleeding off the right
  { a: '#00f0ff', b: '#8a5cff', x: 0.74, y: -0.15, r: 0.42, tilt: 0.4,  bleed: 0, g: 0, h: 1, d: 0, n: 0, p: 0, my: 0.68 },   // 1 about: Victoria Harbour, Hong Kong
  { a: '#ff4d00', b: '#ffb300', x: -0.72, y: 0.10, r: 0.30, tilt: -0.3, bleed: 0, g: 0, h: 0, d: 1, n: 0, p: 0, my: 0.68 },   // 2 work: the Sonoran desert at sunset
  { a: '#00c27a', b: '#0091ff', x: 0.78, y: 0.55, r: 0.26, tilt: 0.5,  bleed: 0, g: 0, h: 0, d: 0, n: 1, p: 0, my: 0.68 },   // 3 expertise: the New York skyline
  { a: '#ff2e93', b: '#7c5cff', x: 0.62, y: -0.05, r: 0.95, tilt: 0.15, bleed: 1, g: 1, h: 0, d: 0, n: 0, p: 0, my: -0.1 },  // 4 contact: the Earth again, oversized
  { a: '#ff2e93', b: '#ffb300', x: 0.72, y: 0.35, r: 0.30, tilt: -0.2, bleed: 0, g: 0, h: 0, d: 0, n: 0, p: 0, my: 0.68 },   // 5 toolkit: stars
  { a: '#00f0ff', b: '#ff2e93', x: 0.0,  y: 0.60, r: 0.20, tilt: 0.0,  bleed: 0, g: 0, h: 0, d: 0, n: 0, p: 1, my: 0.68 },   // 6 experience: Paris
];
const cur = THEMES[0];
const colors = { a: new THREE.Color(cur.a), b: new THREE.Color(cur.b) };
const target = { a: new THREE.Color(), b: new THREE.Color() };

const uniforms = {
  uTime: { value: 0 },
  uA: { value: colors.a }, uB: { value: colors.b },
  uShow: { value: 0 },      // 1 while the cloud is the Earth: fades the body, glow, rings and arcs in and out with it
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.z = 7;

/* Sculpture: the Earth drawn in points of light, with data arcs */
const R = 1.5;
const blob = new THREE.Group();        // positioned / scaled by the layout code
const rig = new THREE.Group(); blob.add(rig);
const globe = new THREE.Group(); rig.add(globe);
const ll = (lat, lon, r = R) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)); };   // east is to the right, as on a map
const coreMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uA: uniforms.uA, uB: uniforms.uB, uBase: { value: new THREE.Color('#03050a') }, uShow: uniforms.uShow },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vV;
    void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: /* glsl */`
    uniform vec3 uA,uB,uBase; uniform float uShow; varying vec3 vN; varying vec3 vV;
    void main(){
      vec3 N=normalize(vN),V=normalize(vV);
      float ndv=clamp(dot(N,V),0.,1.);
      float rim=pow(1.-ndv,3.);
      float diff=clamp(dot(N,normalize(vec3(-.5,.7,.6))),0.,1.);
      vec3 col=uBase*(.82+.28*diff);                       // soft studio shading
      vec3 tint=mix(uB,uA,N.y*.5+.5);                      // colour gradient across the globe
      col=mix(col,tint*(.35+.65*diff),.045);                 // a dark glass body, so the points of light carry the picture
      col+=tint*rim*1.25;                                   // vivid atmosphere
      col+=uA*pow(rim,6.)*.6;
      float alpha=clamp(.62+rim*.38,0.,1.);
      float edge=1.-smoothstep(.0,.1,ndv);                  // crisp outline right at the silhouette
      col=mix(col,mix(vec3(.92,.97,1.),uA,.35),edge);
      gl_FragColor=vec4(col,alpha*uShow);
      #include <colorspace_fragment>
    }`,
});
const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 0.995, 96, 64), coreMat); coreMesh.renderOrder = 1; globe.add(coreMesh);
// soft colour halo behind the globe
const haloMat = new THREE.ShaderMaterial({
  uniforms: { uA: uniforms.uA, uB: uniforms.uB, uShow: uniforms.uShow }, transparent: true, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uA,uB; uniform float uShow; varying vec2 vUv;
    void main(){ float d=length(vUv-.5)*2.; float a=pow(smoothstep(1.,.15,d),2.4);
      gl_FragColor=vec4(mix(uA,uB,vUv.y), a*.34*uShow);
      #include <colorspace_fragment>
    }`,
});
const halo = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), haloMat); halo.position.z = -1.2; halo.renderOrder = -1; blob.add(halo);

// data arcs: a dot sets off along each arc, trailing a fading comet, then disappears when it lands
const RUNNERS = 2;   // two dots travel along each arc at a time
const SEG = 192, TRAIL = 100;   // finer path steps -> smoother motion and trail
const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const PHX = [33.45, -112.07], HKG = [22.32, 114.17];
const PAIRS = [[...PHX, ...HKG], [51, 0, -34, 151], [-23, -46, 48, 2]];   // the first arc stays put: Phoenix to Hong Kong
const arcs = PAIRS.map(([a1, o1, a2, o2], i) => {
  const st = { a1, o1, a2, o2, ta1: a1, to1: o1, ta2: a2, to2: o2, next: 4 + i * 2.3 };   // current ends + the ends it is easing towards
  const pts = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
  const am = arcMat.clone(), pm = pulseMat.clone(); pm.transparent = true; pm.opacity = 0.4; am.vertexColors = true;   // vertexColors lets each trail fade along its length
  const am2 = new THREE.PointsMaterial({ size: 0.036, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });   // soft blobs along the trail make it read thicker
  const baseGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const runners = Array.from({ length: RUNNERS }, (_, k) => {                                // several dots per arc, evenly spaced
    const cg = baseGeo.clone(); cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 4).fill(1), 4));   // rgb stay 1, alpha is animated
    const comet = new THREE.Line(cg, am); comet.frustumCulled = false; globe.add(comet);
    const glow = new THREE.Points(cg, am2); glow.frustumCulled = false; globe.add(glow);        // shares the trail geometry, so it fades and retracts with it
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), pm); globe.add(head);
    return { comet, glow, head, off: k / RUNNERS, dir: k % 2 ? -1 : 1 };                           // every other dot runs the arc backwards
  });
  return { st, pts, am, am2, pm, runners, off: i / (PAIRS.length * RUNNERS) };
});
const sm = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };   // smooth 0->1 ramp
const arcA = new THREE.Vector3(), arcB = new THREE.Vector3();
function rebuildArc(ar) {                                                                   // recompute the path from its current end points
  const { st, pts } = ar;
  arcA.copy(ll(st.a1, st.o1)); arcB.copy(ll(st.a2, st.o2));
  const span = arcA.distanceTo(arcB);
  for (let k = 0; k <= SEG; k++) { const u = k / SEG; pts[k].copy(arcA).lerp(arcB, u).normalize().multiplyScalar(R + 0.04 + Math.sin(Math.PI * u) * 0.15 * span); }
  for (const rn of ar.runners) {
    const pa = rn.comet.geometry.attributes.position;
    for (let k = 0; k <= SEG; k++) pa.setXYZ(k, pts[k].x, pts[k].y, pts[k].z);
    pa.needsUpdate = true;
  }
}
function updateArcs(t, dt) {
  const ease = 1 - Math.pow(0.55, dt);                                                      // slow, smooth glide to each new route
  arcs.forEach((ar, i) => {
    const st = ar.st;
    if (i && t > st.next) {                                                                 // every few seconds the other arcs pick a new route
      st.next = t + 5 + Math.random() * 4;
      st.ta1 = clamp(st.a1 + (Math.random() - 0.5) * 90, -55, 65); st.to1 = st.o1 + (Math.random() - 0.5) * 160;
      st.ta2 = clamp(st.a2 + (Math.random() - 0.5) * 90, -55, 65); st.to2 = st.o2 + (Math.random() - 0.5) * 160;
    }
    st.a1 += (st.ta1 - st.a1) * ease; st.o1 += (st.to1 - st.o1) * ease;
    st.a2 += (st.ta2 - st.a2) * ease; st.o2 += (st.to2 - st.o2) * ease;
    rebuildArc(ar);
    // colour of this arc's dots and trails slowly travels round the colour wheel (each arc at its own phase)
    ar.am.color.copy(colors.a).offsetHSL((t * 0.05 + i * 0.31) % 1, 0, 0.16); ar.am2.color.copy(ar.am.color); ar.am2.size = 0.0425 * blob.scale.x;   // trail thickness follows the globe's size (point size ignores object scale)
    ar.pm.color.copy(ar.am.color).multiplyScalar(0.7);
    ar.am.opacity = ar.am2.opacity = uniforms.uShow.value; ar.pm.opacity = 0.4 * uniforms.uShow.value;
  });
}
updateArcs(0, 0.016); arcs.forEach(ar => { ar.st.next = 4 + Math.random() * 3; });
// two fine orbit rings
const dynA = new THREE.Color(), dynB = new THREE.Color();          // section colours, hue-drifting over time
const ringLineMats = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
const nodeMats = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }));   // plain white and see-through, so they stay in the background
function makeRing(radius, rot, k) {
  const g = new THREE.Group(); g.rotation.set(...rot); rig.add(g);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.002, 6, 400), ringLineMats[k]));   // a very thin solid tube: slightly thicker and brighter than a hairline
  const n = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), nodeMats[k]); g.add(n);
  const n2 = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), nodeMats[k]); g.add(n2);      // second sphere, opposite the first: two move at a time
  return { g, n, n2, radius };
}
const ring1 = makeRing(2.0, [1.25, 0, 0.3], 0), ring2 = makeRing(2.35, [0.5, 0.9, 0], 1);

// halo hugging the globe's outer edge; its colour travels around the rim and drifts over time
const edgeHaloMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: dynA }, uB: { value: dynB }, uTime: uniforms.uTime, uShow: uniforms.uShow }, transparent: true, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uA,uB; uniform float uTime,uShow; varying vec2 vUv;
    const float R=1.5, H=3.3;
    vec3 hue(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a),sa=sin(a); return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.-ca); }
    void main(){
      vec2 p=(vUv-.5)*2.*H; float r=length(p), ang=atan(p.y,p.x);
      float outer=exp(-max(r-R,0.)*3.1)*.95, inner=exp(-max(R-r,0.)*9.)*.55;
      float g=mix(inner,outer,smoothstep(R-.03,R+.01,r));
      g+=exp(-pow((r-R-.04)*16.,2.))*.5;                              // bright thin rim just outside the edge
      g*=1.-smoothstep(H*.72,H,r);
      float band=.5+.5*sin(ang+uTime*.3);                              // one slow, gentle wave around the rim
      vec3 c=hue(mix(uA,uB,smoothstep(0.,1.,band)),.3*sin(uTime*.2+ang));   // colour eases around the rim and over time (whole number of waves per turn, so no seam)
      gl_FragColor=vec4(c,clamp(g,0.,1.)*.8*uShow);
      #include <colorspace_fragment>
    }`,
});
const edgeHalo = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 6.6), edgeHaloMat); edgeHalo.renderOrder = 0; blob.add(edgeHalo);
scene.add(blob);

/* ---------- Particle cloud: one set of points that is the Earth, a star field or a drawn scene ---------- */
// Land mask: 480 x 240 cells, one bit each, row by row from the north pole (Natural Earth coastlines, public domain).
const LW = 480, LH = 240;
const LAND = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD9fwIAAOz///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4PX//x/85vH//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//n4H////////n/wAAAAAAAAAAAAAAWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB94MT/D///////////AwAAAAAAAAAAAHAMgAcAAAAA8AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIj/7/v/Af7///////+fAQAAAABg/w8AAAAAAAAAAAAA3BsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAD4H/8fwP////////8/AAAAAADfAwAAAAAAAAAAAAAAwJ8FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+8Ofh+v+P//////////9PAAAAAICGOwAAAAAAAAAAAAAAAOAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeCAAP2P8AvP////////8PAAAAAADw8AAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJ8AAIAH/v8A+P////////9PAAAAAABgAAAAAAAAAAAOAAAAAIB/AAAAAAAAAAAAAAAAAAAAAAAAAAAA4ODDYDtwAAAAYID///////8/AAAAAAAAAAAAAAAAAP4DAAAAwPj/PwAAAAABAAAAAAAAAAAAAAAAAAAAAPj+Jzzn/z8AAAD8//////8/AAAAAAAAAAAAAAAA4AMAACDA/////wAAAID/OQAAAAAAAAAAAAAAAAAAAAAPAACB/R8AAADg//////8/AAAAAAAAAAAAAAAA/AAAAAD4////DwAAAAAAAAAAAAAAAAAAAAAAAAAA/B8AABT+AAAAAADg//////8fAAAAAAAAAAAAAAAAHwAAAAD4////DQAAAAAwAAAAAAAAAAAAAAAAAAAA/O8ACxw+3v8DAADA//////cBAAAAAAAAAAAAAACABwBgAPj3///f/3/gDwAAAAAAAAAAAAAAAAAAAAAA/v1/D38Gny8PAADA/////z8CAAAAAAAAAAAAAADAAwDwkfP/////////CwD8BQAAAAAAAAAAAAAAAAAAePj/HxgHv/8vAADA+v////8DAAAAAAAAAAAAAADgAwD43P//////////DwH8/wAAAAAAAAAAwBsAAAAAAPz/H4AP/v9/AwAA9P///z8HAAAAAAAAACoAAACADwD++f//////////v////+cPAABAAAAA//8/AABgAPD//4Ef4H//LwCA/f////cBAAAAAAAA7r0AAAAAwAD8/b////////////////8fAAAAAADA////f9D9+uD//2D5wIP6fwAA8////38AAAAAAACA//8fAAACAD74/f////////////////////B//P8DAAAAAAAAAADh+D+HOPA/4P//CQAAAPD///////8fAAAA+P8/nwAMhAAAAAAAAAAAAAAAAAAAAAAA4P8PAAAAAAAAAMDvgD8BDPhBgP7/AQAA4P////////8PAAAAwMcDAAAADAAAAAAAAAAAAAAAAAAAAAAAgP4/AAAAAAAAAAAAAQAAAPh/AOD/AAAA+P////////8HAAAAgOcAAAAABwAAAAAAAAAAAAAAAAAAAAAAgODnAQAAAAAAAAAAAAAAMP8fQMD/AAAg/P/96/////8BAADgwAQAAADAAAAAAAAAAAAAAAAAAAAAAAAAAvAAAAAAAAAAAAAAAAAAkv8/4Pn/AQCQ//8I4P////8AwAHAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAH8////////////////7wH//wAA/P8DAAD/PwAAAMD/D/4/xv////////////////////////////9rAAAA/v//////////////4weA/wEA+P8DAAD4BwAAAOD/D///+P////////////////////////////8/ACiA//////////////9/QIAA3wEA8P8BAAAAAAAAAPT/w/////////////////////////////////9/AADw//////////////8fAAMAeAAA4H8AAAAAAAAAAPz/8P//////////////////////////////8/9/AAD4//////////////8HACD/AAAAwP8AAAAAAAAAAP9/4P/////////////////////////////f+f8BAADw/3////////////8HAAD/AQAAgH8AAAAAAAAAQPx/4P////////////////////////////9g/D8AAAB0/9/T//////////8DAAD/JwAAADAAAAAAAABAgP7/xMf//////////////////////////38AXwQAAAAA/8cAwP////////8DAAD/BwYAAAAAAAAAAAAAgP//AeD/////////////////////////fz/AAwAAAAAAqw8AAP////////8DAID/Fw8AAAAAAAAAAAAIgI9/wP////////////////////////8fAADgBQAAAAAAwBMAAPT///////8PAAD+/x8AAAAAAAAAAAAGAIY/AP7///////////////////////8PAAD4AAAAAAAAYAwAAMj///////8fAAD8/z8AAAAAAAAAAIAfACA/Yf7///////////////////////8DAAD+AQAAAAAAGAAAADD/////////AwD8/x8AAAAAAAAAAAAfADA+8P////////////////////////8AAAD/AwAAAAAADQEAAED+////////DwD+/38AAAAAAAAAAAAcALgH8P///////////////////////38AAAD/AAAAAADAAAAAAMD6/////////wP///8BAAAAAAAAAKA+ADgA8P///////////////////////58AAID/IAAAAAAAAAAAAAD8/////////8P///8HAAAAAAAAAOB4ADDA/f///////////////////////z8AAAA/AAAAAAACAAAAAID8/////////4P//38WAAAAAAAAAPjwAPz//////////////////////////39OAAAfAAAAAAAAAAAAAADw/////////4////8/AAAAAAAAAPj4wv////////////////////////////9vAAAHAEAAgAEAAAAAAADA/////////4////8/AAAAAAAAADj8w/////////////////////////////9/AAAGAAAAAAAAAAAAAADA/////////9////8nAAAAAAAAAADw0f////////////////////////////9vAAACAAAAAAAAAAAAAAAg/f////////////8RAAAAAAAAAAAE/P/////////////////////////////nAAAAAAAAAAAAAAAAAACA/f//////////fwQoAAAAAAAAAAAA/v/////////////////////////////HAAAAAAAAAAAAAAAAAAAA9///////////nyP4AQAAAAAAAADA//////////////////////////////9nAQAAAAAAAAAAAAAAAAAA8P//////////9wP8AQAAAAAAAAD8//////////////////////////////8nAAAAAAAAAAAAAAAAAAAA/P//////////+wOaAQAAAAAAAADw//////////////////////////////8jAAAAAAAAAAAAAAAAAAAA+P///////////wUAAAAAAAAAAADg////////8f+n//////////////////9hAAQAAAAAAAAAAAAAAAAA+P///////////9cAAAAAAAAAAADA//////85+P+B//////////////////8gAAEAAAAAAAAAAAAAAAAA+P/////////f/zsAAAAAAAAAAADA///8//94/X+g/////////////////38AAAAAAAAAAAAAAAAAAAAA+P//////////PwcAAAAAAAAAAADA///w/z8g+D/4/////////////////z9gAAAAAAAAAAAAAAAAAAAA/P//////////BwMAAAAAAAAAAADA/8fh/z8A8H/w/////////////////x/gAwAAAAAAAAAAAAAAAAAA/P//////////AwAAAAAAAAAAAPD/D8DD/x8AwH/g/////////////////wf4AwAAAAAAAAAAAAAAAAAA/P//////////AQAAAAAAAAAAAPD/D5gH/h8AgP/A////////////////PwBEAAAAAAAAAAAAAAAAAAAA+P//////////AwAAAAAAAAAAAPD/DwAe/D/4gP9B////////////////HwAAAAAAAAAAAAAAAAAAAAAA/P////////9/AAAAAAAAAAAAAPD/ARB4/Jz///8D/v//////////////HwAYAAAAAAAAAAAAAAAAAAAA/P////////8fAAAAAAAAAAAAAPD/ABgwPfz////D///////////////4BwAYAAAAAAAAAAAAAAAAAAAA+P////////8bAAAAAAAAAAAAAPD/ABhgePD///+D/////////////3+EAwAYAAAAAAAAAAAAAAAAAAAA+P////////8LAAAAAAAAAAAAAPD/AAAg+PD///8B/////////////x+ABwAcAAAAAAAAAAAAAAAAAAAA4P////////8LAAAAAAAAAAAAAPB/AAAOcPD///8B/////////////3+ADgAPAAAAAAAAAAAAAAAAAAAA4P////////8DAAAAAAAAAAAAALA/ADAMYOD///8H//////////////8HHkAPAAAAAAAAAAAAAAAAAAAA4P////////8HAAAAAAAAAAAAAAAB/j8AAKAZ//////////////////8BHsAHAAAAAAAAAAAAAAAAAAAAwP////////8HAAAAAAAAAAAAAACB/38AAAAA//////////////////8AHugDAAAAAAAAAAAAAAAAAAAAgP////////8DAAAAAAAAAAAAAAD//z8AAAAY/////////////////38ADv8BAAAAAAAAAAAAAAAAAAAAAP7///////8AAAAAAAAAAAAAAID//x8AAAAA//////////////////8AgDwAAAAAAAAAAAAAAAAAAAAAAPj//////z8AAAAAAAAAAAAAAOD//38AAACA//////////////////8BYQIAAAAAAAAAAAAAAAAAAAAAAPD//////x8AAAAAAAAAAAAAAPD///8HcACA//////////////////8BwAAAAAAAAAAAAAAAAAAAAAAAAPD//////w8AAAAAAAAAAAAAAPj///8f+AHA//////////////////8DQAAAAAAAAAAAAAAAAAAAAAAAAGD+/////wcAAAAAAAAAAAAAAPj///9/+B/3//////////////////8DQAAAAAAAAAAAAAAAAAAAAAAAAGD8////6QcAAAAAAAAAAAAAAPj//////f////////////////////8BAAAAAAAAAAAAAAAAAAAAAAAAAMD8///xAA4AAAAAAAAAAAAAAPj////////3///4//////////////8DAAAAAAAAAAAAAAAAAAAAAAAAAID5//8BAAwAAAAAAAAAAAAAAPz////////////w//////////////8DAAAAAAAAAAAAAAAAAAAAAAAAAADz/z8AAAwAAAAAAAAAAAAAAP/////////v///x//////////////8BAAAAAAAAAAAAAAAAAAAAAAAAAIDj/z8AABwAAAAAAAAAAAAAwP////////8f///D//////////////8BAAAAAAAAAAAAAAAAAAAAAAAAAADG/z8AAJwAAAAAAAAAAAAAwP////////8f//8H8P////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAADM/z8AABgAAAAAAAAAAAAA4P////////8//v8X8P////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAI/z8AAAAEAAAAAAAAAAAA8P////////8//P8XBAD+/////////38AAAAAAAAAAAAAAAAAAAAAAAAAAAAI/j8AAAAAAAAAAAAAAAAA8P////////9//P8PDgD8/////////x8iAAAAAAAAAAAAAAAAAAAAAAAAAAAg/D8AAAAAAAAAAAAAAAAA+P////////9/+P//PwD4/////////x8DAAAAAAAAAAAAAAAAAAAAAAAAAAAA+D8AAD4AAAAAAAAAAAAA/P//////////8P//fwDQ/////////wcDAAAAAAAAAAAAAAAACAAAAAAAAAAA+D8AAPgAAAAAAAAAAAAA/P//////////8f///wDw/v///f//fwAAAAAAAAAAAAAAAAAAIAAAAAAAAAAA8D8ADoADAAAAAAAAAAAA/v//////////8f//fwDg/v8P+P//CAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAA8D+ADwAOAAAAAAAAAAAA/P//////////4///fwAA/v8P+P8/BAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAA+H+ABwBBAgAAAAAAAAAA/P//////////w///HwAA/v8H4P8fDAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAA4P+ABwCABwAAAAAAAAAA/P//////////g///HwAA/v8B4P8fBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwP/7AwDh1wAAAAAAAAAA+P//////////h///BwAA/v8AwP8fAgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7/AwAAAAAAAAAAAAAA+P//////////D///AwAA/H8AwP8/AAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPj/AwAAAAAAAAAAAAAA/P//////////D/7/AAAA/D8AwP1/AAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD5AwAAAAAAAAAAAAAC/P//////////D/4/AAAA/A8AgPz/AAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw/wAAAAAAAAAAAAAA/P//////////H/4fAAAA/AcAAPz/AQADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg/wEAAAAAAAAAAAAA/v//////////f/4DAAAA+AcAAPj/AQADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA/wEAAAAAAAAAAAAA/P////////////wAAAAA+AcAAPj/AwAyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+AEAAAABAAAAAAAA/P///////////x0AAAAA8AcAAJj/AwASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAQAAAAAAAAAA/P///////////wOAAAAA8AcAABD/AwBaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ACAAAAAAAAAAAAA+P///////////wEIAAAA4AMACBD+AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAHwHgAAAAAAAAAA8P///////////8MPAAAA4AMAABj8AABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAH4/k0AAAAAAAAA4P////////////8PAAAAwAMAAAAwAEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEP4/n8AAAAAAAAAwP////////////8PAAAAwAkAAAgQAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL/9/z8AAAAAAAAAwP////////////8HAAAAwAgAABgAABDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj///8BAAAAAAAAgP////////////8DAAAAABwAADAAAAD4AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8DAAAAAAAAAP////////////8DAAAAABwAACAAAADgAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+//8HAAAAAAAAAPz/z/////////8BAAAAABgAAMAAABhgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////AQAAAAAAAPj/gP////////8BAAAAAAAAAMABADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////AwAAAAAAAPAggP////////8AAAAAAAAAgMcDAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////DwAAAAAAAAAAAPD///////8AAAAAAAAAAMcDAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+////DwAAAAAAAAAAAOj//////38AAAAAAAAAAJ4DgB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////DwAAAAAAAAAAAOD//////z8AAAAAAAAAADwD8B8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID/////HwAAAAAAAAAAAOD//////w8AAAAAAAAAAPgG8B8ABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD/////HwAAAAAAAAAAAOD//////wcAAAAAAAAAAPAB/j9CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD/////HwAAAAAAAAAAAOD//////wMAAAAAAAAAAPAD/h8QDAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAOD/////dwAAAAAAAAAAAPD//////wEAAAAAAAAAAOAD/h8ARgEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////5wcAAAAAAAAAAPD//////wAAAAAAAAAAAMAH+I8NwCcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////3x8AAAAAAAAAAOD/////fwAAAAAAAAAAAMA3+IfDIIcBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD//////38AAAAAAAAAAOD/////PwAAAAAAAAAAAKA/+IcHAM4PAAEAAAAAAAAAAAAAAAAAAAAAAAAAAOD///////8PAAAAAAAAAMD/////HwAAAAAAAAAAAAAfIMcHO/5/AAQAAAAAAAAAAAAAAAAAAAAAAAAAAPD///////8fAAAAAAAAAID/////HwAAAAAAAAAAAAAeAIAMAPD/AQAAAAAAAAAAAAAAAAAAAAAAAAAAAPD///////8/AAAAAAAAAAD/////DwAAAAAAAAAAAAAcAIAIAMD/AwQAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////////AQAAAAAAAAD/////DwAAAAAAAAAAAAAAAIAAAAj/x0MAAAAAAAAAAAAAAAAAAAAAAAAAAPD/////////AQAAAAAAAAD+////DwAAAAAAAAAAAADgAQAAAAD+H4AAAAAAAAAAAAAAAAAAAAAAAAAAAMD/////////AwAAAAAAAAD+////HwAAAAAAAAAAAADA/wEAiAD+DwACAAAAAAAAAAAAAAAAAAAAAAAAAMD/////////AwAAAAAAAAD8////HwAAAAAAAAAAAAAA+AEAAQD/HAACAAAAAAAAAAAAAAAAAAAAAAAAAID/////////AQAAAAAAAAD8////DwAAAAAAAAAAAAAAAFuPAQB4OAJAAAAAAAAAAAAAAAAAAAAAAAAAAID/////////AQAAAAAAAAD8////HwAAAAAAAAAAAAAAAIBgAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////AAAAAAAAAAD8////HwAAAAAAAAAAAAAAAAAhAAAgwAIAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////9/AAAAAAAAAAD8////PwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+//////8/AAAAAAAAAAD8////PwAAAAAAAAAAAAAAAAAAQAAgAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAD8//////8fAAAAAAAAAAD8////PwACAAAAAAAAAAAAAAAAwF9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8//////8PAAAAAAAAAAD+////PwAGAAAAAAAAAAAAAAAAwD9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8//////8PAAAAAAAAAAD+////PwAHAAAAAAAAAAAAAAAA4B9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4//////8PAAAAAAAAAAD/////PwAHAAAAAAAAAAAAAACA5x/gAQAAAAAAAAAAAAAAAAAAAAAAAAAAAADw//////8PAAAAAAAAAAD/////P8AHAAAAAAAAAAAAAADA/z/gAwAAQAAAAAAAAAAAAAAAAAAAAAAAAADA//////8PAAAAAAAAAAD/////H/ADAAAAAAAAAAAAAADA/3/gAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8PAAAAAAAAAAD/////D/gDAAAAAAAAAAAAAADo///xAwAAAABAAAAAAAABAAAAAAAAAAAAAAAA/v////8PAAAAAAAAAAD/////A/gDAAAAAAAAAAAAAAD4////BwAAAAEgAAAAAAAAAAAAAAAAAAAAAAAA/P////8HAAAAAAAAAAD/////AfgDAAAAAAAAAAAAAAD4////BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P////8HAAAAAAAAAAD+////APgBAAAAAAAAAAAAAAD8////BwAAAAAgAAAAAAAAAAAAAAAAAAAAAAAA/P////8HAAAAAAAAAAD+//8/APgBAAAAAAAAAAAAAAD/////HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P////8DAAAAAAAAAAD8//8/APgBAAAAAAAAAAAAAOD/////PwAACAAAAAAAAAAAAAAAAAAAAAAAAAAA+P////8BAAAAAAAAAAD8//9/APwAAAAAAAAAAAAAAPz/////fwAAEAAAAAAAAAAAAAAAAAAAAAAAAAAA/P////8BAAAAAAAAAAD4//9/APwAAAAAAAAAAAAAAP7/////fwAAQAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///78AAAAAAAAAAAD4//9/APwAAAAAAAAAAAAAAP///////wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///w8AAAAAAAAAAAD4//9/AHwAAAAAAAAAAAAAgP///////wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///wEAAAAAAAAAAAD4//9/AHwAAAAAAAAAAAAAgP///////wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P///wAAAAAAAAAAAADw//8fADgAAAAAAAAAAAAAAP///////wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P//fwAAAAAAAAAAAADw//8PAAAAAAAAAAAAAAAAgP///////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/P//fwAAAAAAAAAAAADw//8PAAAAAAAAAAAAAAAAgP///////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//fwAAAAAAAAAAAADw//8PAAAAAAAAAAAAAAAAAP///////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//fwAAAAAAAAAAAADg//8HAAAAAAAAAAAAAAAAAP///////x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//PwAAAAAAAAAAAADA//8HAAAAAAAAAAAAAAAAAP7//////x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//HwAAAAAAAAAAAACA//8DAAAAAAAAAAAAAAAAAP7//////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA////DwAAAAAAAAAAAACA//8BAAAAAAAAAAAAAAAAAP7//////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA////BwAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAPz//////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//AwAAAAAAAAAAAAAA/38AAAAAAAAAAAAAAAAAAPz/B////w8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//AwAAAAAAAAAAAAAA/z8AAAAAAAAAAAAAAAAAAPx/APj//wcAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AQAAAAAAAAAAAAAA/w8AAAAAAAAAAAAAAAAAAPwfAHD//wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AAAAAAAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAH4AALD//wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAID+/wEAAAAAAAAAAAAAAAAAAAAAAAAAAACA//8PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAAAIABAAAAAAAAAAAAAAAAAAAAAACA//8PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8/wAAAAABAAAAAAAAAAAAAAAAAAAAAADA//8PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8/wAAAAAGAAAAAAAAAAAAAAAAAAAAAADA//8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4HwAAAAAuAAAAAAAAAAAAAAAAAAAAAADA//8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACADAAAAAA+AAAAAAAAAAAAAAAAAAAAAADA/x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAADA/x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAMAAAAAAAAAAAAAAAAAAAAAADg/x0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAEAGAAAAAAAAAAAAAAAAAAAAAABA/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgAAAOAAAAAAAAAAAAAAAAAAAAAAAACg/wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAPAAAAAAAAAAAAAAAAAAAAAAAACg/wMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAHgAAAAAAAAAAAAAAAAAAAAAAADg/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAADA/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAACAfwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgA8AAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAcAAAAAAAAAAAAAAAAAAAAAAADgfwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4fwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4PwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwLwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4DwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADwDwACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAH4ABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcgAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAD4BwAAAAAAAMA/+AEA4HcAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAA8AMAAAAAAAAAAAAAAAAAAAAAAAD6PwAAAAD8/////7n+////AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAEAAAAAAAAAAAAAAAAAAAAAAPD+//8fAPD/////////////BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAUAAAAAAAAAAAAAAAAAAAAAgP////8fAP7//////////////yEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5y8AAAAAAAAAAAAAAAAAAABw4P////8PwP////////////////8PAAAAAAAAAAAAAAAAAAAAAAAAAAAI7h8AAAAAAAAAAAAAAgACAAj4//////8D/v////////////////8/AAAAAAAAAAAAAAAAAAAAAAAAAAAc2B8AAAAAAAAAAMAR8P//8/H///////8P//////////////////9//wAAAAAAAAAAAAAAAAAAAAAAAADw338AAAAAAAAAAO9///////////////+D/////////////////////w8AAAAAAAAAAAAAAAAAAPgBAACAj38AAAAAAAAAAP7////////////////j/////////////////////wcAAAAAAAAAAAAAAAAA0D9AAyAY8P8AAAAAAAAA+P/////////////////9////////////////////vwIAAAAAAAAAAAAA9wEAgP///////38AAAAAAAAQ7P//////////////////////////////////////HwAAAAAAAAAAAAAAAP4YAPj//////x8AAAAAAAAA////////////////////////////////////////AQAAAAAAAAAA4P////////3//////w8AAAAAAACA//////////////////////////////////////9/AAAAAAAAAADs////////////////PwAAAAAAAPD/////////////////////////////////////////AQAAAAAAAADQ//////////////8BAAAAAAAAgP//////////////////////////////////////////AQAAAAAA4H/+//////////////9/AAAAAAAA/P//////////////////////////////////////////wwEAAAAAAPz///////////////0AQAAAwD8A////////////////////////////////////////////HwAAAADgA/D//////////////wcADgAA4D8A+f////////////////////////////////////////8/AAAAAAAAAAD4//////////////8DgMEA8H8AwAD+//////////////////////////////////////8fAAAAAAAAAAD+//////////////8HAvYAfwAA/P////////////////////////////////////////8/AAAAAADggP///////////////////wAAAAD///////////////////////////////////////////8/AAAAAAAAAPj//////////////////wAA/Mf/////////////////////////////////////////////AwAAAAVAAP7//////////////////x/4////////////////////////////////////////////////fwAAAID//////////////////////////////////////////////////////////////////////////x8A+P8PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const LOW = innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;   // phones and small machines get fewer points
const landBits = Uint8Array.from(atob(LAND), c => c.charCodeAt(0));
const isLand = (lat, lon) => { const x = Math.min(LW - 1, Math.floor((lon + 180) / 360 * LW)), y = Math.min(LH - 1, Math.floor((90 - lat) / 180 * LH)), i = y * LW + x; return (landBits[i >> 3] >> (i & 7)) & 1; };
const cloudU = {
  uTime: uniforms.uTime, uA: uniforms.uA, uB: uniforms.uB,
  uG: { value: 0 }, uH: { value: 0 }, uD: { value: 0 }, uN: { value: 0 }, uP: { value: 0 },   // how much of the cloud is the Earth / the harbour / the desert / New York / Paris (the rest drifts as stars)
  uHP: { value: new THREE.Vector3(0, -0.5, 4.5) }, uDP: { value: new THREE.Vector3(0, -0.5, 4.5) }, uNP: { value: new THREE.Vector3(0, -0.5, 4.5) }, uPP: { value: new THREE.Vector3(0, -0.5, 4.5) },   // each drawn scene: the part of it that is centred, the height of its horizon, its size
  uScroll: { value: 0 }, uScale: { value: 1 }, uPx: { value: 1 }, uAspect: { value: 1 },
  uMouse: { value: state.smooth }, uRepel: { value: 0 },
};
/* ---------- Drawn scenes: Victoria Harbour, the Sonoran desert, Camelback Mountain ----------
   Each scene says where every point of the cloud sits while its section is on screen. x runs from -1 to 1 across the window and
   y = 0 is the horizon (the waterline), in the same units. A point also has a depth (0 near .. 1 far), a kind (0 window or steady
   light, 1 water, 2 star, 3 boat or balloon, 4 blinking warning light, 5 outline), a brightness, a tint (0..1 across the section's
   two colours, 2 red, 3 amber) and a phase (for a boat, its speed). */
// Hand a drawn scene's points out to the cloud: outlines first, then as much of the rest as fits. Most spare points stay dark,
// so the sky is not crowded; the others become stars above the skyline (top(x) is the highest thing drawn at x).
function handOut(n, key, fill, rand, top) {
  const at = new Float32Array(n * 3), as = new Float32Array(n * 4);
  const nk = Math.min(n, key.length / 7), order = Array.from({ length: fill.length / 7 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
  const nf = Math.min(order.length, Math.max(0, Math.round((n - nk) * 0.88)));
  for (let i = 0; i < n; i++) {
    let s, o;
    if (i < nk) { s = key; o = i * 7; }
    else if (i < nk + nf) { s = fill; o = order[i - nk] * 7; }
    else { let x, y, tries = 0; do { x = -1.1 + rand() * 2.2; y = rand() * 0.9; } while (y < top(x) + 0.012 && ++tries < 8);
      s = [x, y, 1.3, 2, rand() < 0.3 ? 0.03 + 0.85 * rand() ** 11 : 0, rand(), rand()]; o = 0; }
    at.set([s[o], s[o + 1], s[o + 2]], i * 3); as.set([s[o + 3], s[o + 4], s[o + 5], s[o + 6]], i * 4);
  }
  return { at, as };
}
// sketch() is the pencil the scenes are drawn with: points, lines, buildings, water, rock skylines, saguaros and a desert floor. Key points draw
// the outlines and are always kept; fill points are thinned to fit the cloud. occ is the skyline so far: nearer things hide
// what stands behind them. The random numbers are seeded, so every visit sees the same picture.
function sketch(seed) {
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const key = [], fill = [], X0 = -1.1, CW = 0.002, NC = 1100, occ = new Float32Array(NC), occTint = new Float32Array(NC);
  const col = x => clamp(Math.floor((x - X0) / CW), 0, NC - 1), top = x => occ[col(x)];
  const put = (list, x, y, z, kind, bright, tint, ph) => list.push(x, y, z, kind, bright, tint, ph === undefined ? rand() : ph);
  const line = (x1, y1, x2, y2, o = {}) => {
    const { z = 0.5, kind = 5, bright = 1, tint = 0.5, step = 0.0035, ph } = o, m = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let k = 0; k <= m; k++) put(key, lerp(x1, x2, k / m), lerp(y1, y2, k / m), z, kind, bright, tint, ph);
  };
  const PX = 0.0045, PY = 0.0055;                              // window spacing
  // a building: windows on a grid with a brighter outline. top(u) is the roof height across its width (u = 0..1).
  // style: 0 scattered windows, 1 lit columns, 2 lit bands, 3 an even grid
  function tower(xc, w, top, o = {}) {
    const { tint = rand(), lit = 0.5, z = 0.5, bright = 0.6, style = 0, edge = 1 } = o;
    const x0 = xc - w / 2, nx = Math.max(2, Math.round(w / PX)), dx = w / nx;
    for (let i = 0; i < nx; i++) {
      const u = (i + 0.5) / nx, x = x0 + (i + 0.5) * dx, h = top(u), base = occ[col(x)];
      const side = i === 0 || i === nx - 1 ? 0 : Math.min(top(u - 1 / nx), top(u + 1 / nx)), ny = Math.floor(h / PY);
      for (let j = 0; j <= ny; j++) {
        const y = j < ny ? (j + 0.5) * PY : h; if (y <= base + PY * 0.5) continue;
        if (j === ny || y > side) { put(key, x, y, z, 5, bright * edge, tint); continue; }
        const on = style === 1 ? i % 2 === 0 && rand() < 0.85 : style === 2 ? j % 3 === 0 || rand() < lit * 0.3 : style === 3 ? i % 2 === 0 && j % 2 === 0 : rand() < lit;
        if (on) put(fill, x, y, z, 0, bright * (0.6 + 0.4 * rand()), tint);
      }
    }
    for (let c = col(x0), c1 = col(x0 + w); c <= c1; c++) { const h = top(clamp((X0 + (c + 0.5) * CW - x0) / w, 0, 1)); if (h > occ[c]) { occ[c] = h; occTint[c] = tint; } }
  }
  // the water in front of a city: a lit waterfront, the skyline's reflection, and loose glitter
  const water = () => {
    for (let x = X0; x < 1.1; x += 0.003) put(key, x, 0.002, 0, 5, 0.75, 3);
    for (let c = 0; c < NC; c++) {
      const H = Math.max(occ[c], 0.02), x = X0 + (c + 0.5) * CW;
      for (let k = Math.round(H * 50) + 1; k > 0; k--) { const u = rand(); put(fill, x + (rand() - 0.5) * (0.003 + 0.016 * u), -(0.005 + H * 1.05 * u ** 1.25), 0, 1, 0.1 + 0.6 * (1 - u) ** 1.5, occTint[c]); }
    }
    for (let k = 0; k < 800; k++) put(fill, X0 + rand() * 2.2, -rand() * 0.52, 0, 1, 0.06 + 0.14 * rand(), rand());
  };
  // a skyline of rock, f(x) high: its outline, then either contour lines that follow its shape (levels) or flat beds of rock (strata)
  const ridge = (f, o = {}) => {
    const { z = 0.8, bright = 0.6, tint = 0.5, levels = [], strata = 0, body = 0.35 } = o;
    let prev = null;
    for (let x = X0; x < 1.1; x += 0.0022) {
      const y = f(x), b = top(x);
      if (y > b + 0.002) { put(key, x, y, z, 5, bright, tint);
        if (prev !== null && Math.abs(y - prev) > 0.006) line(x, Math.max(Math.min(y, prev), b), x, Math.max(y, prev), { z, bright, tint }); }   // a cliff
      prev = y;
    }
    for (const q of levels) for (let x = X0; x < 1.1; x += 0.005) { const y = f(x) * q + 0.004 * Math.sin(x * 31 + q * 9); if (y > top(x) + 0.003 && y < f(x) - 0.004 && rand() < 0.8) put(fill, x, y, z, 0, bright * body * (0.5 + q), tint); }
    if (strata) for (let y = strata; y < 1; y += strata) for (let x = X0; x < 1.1; x += 0.0055) if (y < f(x) - 0.004 && y > top(x) + 0.003 && rand() < 0.7) put(fill, x, y, z, 0, bright * body, tint);
    for (let c = 0; c < NC; c++) occ[c] = Math.max(occ[c], f(X0 + (c + 0.5) * CW));
  };
  // a saguaro H tall standing at (x, y0); each arm is [side, where it leaves the trunk, where it ends, how far out], as fractions of H
  const saguaro = (x, y0, H, arms, o = {}) => {
    const { z = 0.1, bright = 0.9, tint = 0.3 } = o, w = H * 0.1, L = { z, bright, tint, step: Math.max(0.003, H * 0.012) };
    const stem = (cx, ya, yb, hw, s) => {
      for (const d of [-1, 0, 1]) line(cx + d * hw, ya + (s && d === -s ? 2 * hw : 0), cx + d * hw, yb - (d ? hw * 0.6 : 0), { ...L, bright: d ? bright : bright * 0.45 });
      for (let k = 1; k < 6; k++) { const a = k / 6 * Math.PI; put(key, cx + Math.cos(a) * hw, yb - hw * 0.6 + Math.sin(a) * hw * 0.9, z, 5, bright, tint); }
    };
    stem(x, y0, y0 + H, w / 2, 0);
    for (const [s, a, b, l] of arms) { const ax = x + s * (w / 2 + l * H), hw = w * 0.36, ya = y0 + a * H;
      line(x + s * w / 2, ya - hw, ax + s * hw, ya - hw, L); line(x + s * w / 2, ya + hw, ax - s * hw, ya + hw, L); stem(ax, ya - hw, y0 + b * H, hw, s); }
  };
  // the desert floor: rows of points that open out towards the viewer, over low swells
  const floor = (bright = 0.55) => {
    for (let r = 1; r <= 30; r++) { const y = -0.005 * r ** 1.4, dx = 0.006 + 0.0022 * r;
      for (let x = X0 + (r % 2) * dx / 2; x < 1.1; x += dx) put(fill, x + (rand() - 0.5) * dx * 0.3, y + 0.006 * (r / 30) * Math.sin(x * 7 + r * 0.6), 0, 0, bright * (1 - r / 45) * (0.6 + 0.4 * rand()), rand()); }
  };
  return { rand, key, fill, put, line, tower, water, ridge, saguaro, floor, top, occ, col, X0, done: n => handOut(n, key, fill, rand, top) };
}
// Victoria Harbour at night, seen from Tsim Sha Tsui: x runs from -1 (east: Causeway Bay) to 1 (west: Sheung Wan).
function harbour(n) {
  const { rand, key, fill, put, line, tower, water, occ, col, X0 } = sketch(41);
  const flat = h => () => h;
  const env = x => Math.min(1.05, 0.55 + 0.45 * Math.exp(-(((x - 0.12) / 0.5) ** 2)) + 0.25 * Math.exp(-(((x + 0.5) / 0.2) ** 2)));   // tallest around Central and Wan Chai

  // the waterfront: the Convention Centre's winged roof reaching into the harbour, the piers and low blocks
  tower(-0.63, 0.25, u => 0.016 + 0.034 * Math.sin(Math.PI * u) ** 0.7 * (0.72 + 0.28 * Math.abs(Math.cos(3 * Math.PI * u))), { tint: 0.15, z: 0.15, bright: 0.9, lit: 0.6 });
  for (let x = X0; x < 1.1;) {
    const w = 0.018 + rand() * 0.035, h = (0.022 + rand() * 0.05) * env(x);
    if (x + w < -0.76 || x > -0.5) tower(x + w / 2, w, flat(h), { z: 0.2, bright: 0.75, lit: 0.55, style: rand() < 0.25 ? 1 : rand() < 0.25 ? 2 : 0 });
    x += w + rand() * 0.006;
  }
  // the landmarks, east to west
  const L = { z: 0.5, bright: 0.9 };
  tower(-0.52, 0.05, u => 0.255 + 0.04 * (1 - Math.abs(2 * u - 1)), { ...L, tint: 3, style: 2 });                 // Central Plaza: gold, with a pyramid and a mast
  line(-0.52, 0.295, -0.52, 0.335, { tint: 3 }); put(key, -0.52, 0.339, 0.5, 4, 1, 2);
  tower(-0.4, 0.036, u => (Math.abs(2 * u - 1) < 0.5 ? 0.16 : 0.148), { ...L, bright: 0.7, style: 1 });             // Hopewell Centre
  tower(-0.215, 0.03, flat(0.115), { ...L, tint: 3, lit: 0.8, bright: 0.7 });                                        // Far East Finance Centre
  tower(-0.17, 0.028, u => 0.15 - 0.012 * (Math.floor(u * 4) % 2), { ...L, tint: 0.1, bright: 0.75 });              // Lippo Centre's two towers
  tower(-0.135, 0.028, u => 0.14 - 0.012 * (Math.floor(u * 4) % 2), { ...L, tint: 0.1, bright: 0.75 });
  { const xc = -0.03, w = 0.056, h = 0.27, x0 = xc - w / 2, top = u => h * (u < 0.5 ? 0.6 + 0.36 * u : 0.84 + 0.32 * (u - 0.5));   // Bank of China Tower: stepped glass prisms, crossed braces, two masts
    tower(xc, w, top, { ...L, tint: 0.05, lit: 0.22, bright: 1 });
    for (let y0 = 0.05; y0 < h; y0 += w) for (const d of [0, 1]) {
      const m = Math.round(w / 0.003);
      for (let k = 0; k <= m; k++) { const u = k / m, y = y0 + w * (d ? 1 - u : u); if (y < top(u) - 0.004) put(key, x0 + u * w, y, 0.5, 5, 1, 0.05); }
    }
    line(xc, 0.05, xc, top(0.49), { tint: 0.05 });
    for (const u of [0.78, 0.93]) { line(x0 + u * w, top(u), x0 + u * w, h * 1.15, { tint: 0.05 }); put(key, x0 + u * w, h * 1.165, 0.5, 4, 1, 2); } }
  tower(0.05, 0.044, flat(0.235), { ...L, style: 3, tint: 0.85 });                                                   // Cheung Kong Center
  tower(0.115, 0.052, u => (u < 0.3 ? 0.135 : u < 0.7 ? 0.158 : 0.145), { ...L, style: 2, tint: 0.3, bright: 0.8 });   // HSBC: its hanging trusses
  for (const y of [0.05, 0.08, 0.11]) line(0.091, y, 0.139, y, { bright: 0.8 });
  tower(0.215, 0.04, flat(0.168), { ...L, style: 3, tint: 0.6, bright: 0.8 });                                       // Jardine House: round windows
  tower(0.262, 0.022, u => 0.172 - 0.01 * (2 * u - 1) ** 2, { ...L, tint: 0.95, bright: 0.7 });                     // Exchange Square
  tower(0.287, 0.022, u => 0.165 - 0.01 * (2 * u - 1) ** 2, { ...L, tint: 0.95, bright: 0.7 });
  tower(0.325, 0.03, u => (Math.abs(2 * u - 1) > 0.7 ? 0.175 : 0.2), { ...L, tint: 0.2, bright: 0.8 });             // One IFC
  tower(0.385, 0.056, u => { const a = Math.abs(2 * u - 1), h = 0.4;                                                 // Two IFC: tapering, with a crown of prongs
    return a > 0.86 ? h * 0.72 : a > 0.7 ? h * 0.88 : h * (1 - 0.035 * (Math.floor(u * 24) % 2)); }, { ...L, tint: 0.25, style: 1, bright: 1 });
  put(key, 0.385, 0.405, 0.5, 4, 1, 2);
  tower(0.44, 0.03, flat(0.14), { ...L, bright: 0.65 });                                                             // Four Seasons
  tower(0.56, 0.042, u => 0.245 + 0.012 * (1 - Math.abs(2 * u - 1)), { ...L, style: 2, tint: 0.7 });                 // The Center: bands of colour and a spire
  line(0.56, 0.257, 0.56, 0.295, { tint: 0.7 }); put(key, 0.56, 0.299, 0.5, 4, 1, 2);
  tower(0.72, 0.03, flat(0.135), { ...L, tint: 2, lit: 0.3, bright: 0.7 });                                          // Shun Tak Centre: red
  tower(0.757, 0.03, flat(0.13), { ...L, tint: 2, lit: 0.3, bright: 0.7 });
  { const cx = 0.165, cy = 0.043, r = 0.034;                                                                         // the observation wheel on the Central waterfront
    for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; put(key, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.1, 5, 1, 0.5); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; for (const q of [0.3, 0.55, 0.8]) put(key, cx + Math.cos(a) * r * q, cy + Math.sin(a) * r * q, 0.1, 5, 0.55, 0.5); }
    line(cx, cy, cx - 0.014, 0.004, { z: 0.1, bright: 0.6 }); line(cx, cy, cx + 0.014, 0.004, { z: 0.1, bright: 0.6 }); }
  // the city behind: office blocks, then the thin towers of the Mid-Levels
  for (let x = X0; x < 1.1;) { const w = 0.016 + rand() * 0.03; tower(x + w / 2, w, flat((0.07 + rand() * 0.1) * env(x)), { z: 0.6, bright: 0.55, lit: 0.5, edge: 0.8, style: rand() < 0.2 ? 1 : rand() < 0.2 ? 2 : 0 }); x += w + rand() * 0.01; }
  for (let x = X0; x < 1.1;) { const w = 0.01 + rand() * 0.014; tower(x + w / 2, w, flat((0.1 + rand() * 0.11) * env(x)), { z: 0.8, bright: 0.36, lit: 0.42, edge: 0.7 }); x += w + rand() * 0.02; }
  // Victoria Peak and the ridge of the island behind the city
  const ridge = x => 0.1 + 0.19 * Math.exp(-(((x - 0.18) / 0.33) ** 2)) + 0.12 * Math.exp(-(((x + 0.35) / 0.3) ** 2)) + 0.07 * Math.exp(-(((x - 0.72) / 0.22) ** 2)) + 0.007 * Math.sin(x * 23) + 0.004 * Math.sin(x * 57 + 1);
  for (let x = X0; x < 1.1; x += 0.0022) if (ridge(x) > occ[col(x)] + 0.003) put(key, x, ridge(x), 1, 5, 0.24, 0.5);
  for (let k = 0; k < 1800; k++) { const x = X0 + rand() * 2.2, y = ridge(x) * rand() ** 0.7; if (y > occ[col(x)] + 0.004) put(fill, x, y, 1, 0, 0.1 + 0.22 * rand() * (1 - y / 0.3), rand() < 0.3 ? 3 : rand()); }
  water();
  // a Star Ferry and a red-sailed junk crossing; their phase is their speed
  { const x = -0.3, y = -0.02, v = 0.009, o = { z: 0, kind: 3, ph: v, step: 0.0024 };
    line(x, y, x + 0.05, y, { ...o, bright: 0.9, tint: 0.2 }); line(x + 0.002, y + 0.0045, x + 0.048, y + 0.0045, { ...o, bright: 1, tint: 3 });
    line(x + 0.006, y + 0.009, x + 0.044, y + 0.009, { ...o, bright: 0.9, tint: 3 }); line(x + 0.004, y + 0.0125, x + 0.046, y + 0.0125, { ...o, bright: 0.7, tint: 0.2 });
    line(x + 0.025, y + 0.0125, x + 0.025, y + 0.02, { ...o, bright: 0.8, tint: 0.2 }); }
  { const x = 0.52, y = -0.085, v = -0.006, o = { z: 0, kind: 3, ph: v, step: 0.0026 }, len = 0.075;
    for (let k = 0; k <= 30; k++) { const u = k / 30, yy = y + 0.008 * (2 * u - 1) ** 2; put(key, x + u * len, yy, 0, 3, 0.9, 3, v); put(key, x + u * len, yy + 0.0035, 0, 3, 0.6, 3, v); }
    for (const [u, H, W] of [[0.2, 0.04, 0.012], [0.52, 0.062, 0.017], [0.84, 0.036, 0.01]]) {                        // three ribbed sails
      const mx = x + u * len;
      for (let j = 0, rows = Math.round(H / 0.0032); j <= rows; j++) {
        const q = j / rows, yy = y + 0.013 + q * H, hw = W * Math.sin(Math.PI * Math.min(1, q * 0.85 + 0.12)) ** 0.6;
        line(mx - hw * 0.45, yy, mx + hw * 1.35, yy, { ...o, bright: j % 3 === 0 ? 1 : 0.55, tint: 2 });
      }
    } }
  // whatever is left over becomes the night sky above the city and the Peak
  return handOut(n, key, fill, rand, x => Math.max(occ[col(x)], ridge(x)));
}
// The Sonoran desert at sunset: saguaros, buttes and spires, a road running out to a low striped sun, a balloon drifting over.
function desert(n) {
  const { rand, key, fill, put, line, ridge, saguaro, floor, top, done } = sketch(77);
  saguaro(-0.75, -0.1, 0.4, [[-1, 0.42, 0.78, 0.13], [1, 0.52, 0.9, 0.11]]);
  saguaro(0.77, -0.07, 0.33, [[1, 0.4, 0.72, 0.12], [-1, 0.55, 0.88, 0.1]]);
  saguaro(-0.57, -0.04, 0.19, [[1, 0.5, 0.82, 0.11], [-1, 0.35, 0.62, 0.1]], { bright: 0.8 });
  saguaro(0.56, -0.035, 0.16, [[-1, 0.4, 0.75, 0.12], [1, 0.55, 0.85, 0.1]], { bright: 0.8 });
  saguaro(-0.42, -0.025, 0.14, [[1, 0.45, 0.8, 0.12]], { bright: 0.7 });
  saguaro(0.06, -0.012, 0.085, [[-1, 0.5, 0.85, 0.12]], { bright: 0.6 });
  const butte = (x, xc, w, h, skirt) => { const d = Math.abs(x - xc) - w / 2; return d < 0 ? h * (1 + 0.012 * Math.sin(x * 90) * Math.sin(x * 37)) : Math.max(0, h * 0.42 * (1 - d / skirt)); };   // a flat top, a cliff, then a skirt of scree
  ridge(x => Math.max(0.012 + 0.006 * Math.sin(x * 11),
    butte(x, -0.66, 0.13, 0.3, 0.1), butte(x, -0.555, 0.016, 0.24, 0.025),                  // a mitten and its thumb
    butte(x, -0.24, 0.11, 0.26, 0.09), butte(x, -0.325, 0.016, 0.2, 0.03),
    butte(x, 0.74, 0.2, 0.21, 0.11), butte(x, 0.47, 0.014, 0.16, 0.035), butte(x, 0.5, 0.01, 0.12, 0.025)), { z: 0.6, bright: 0.85, tint: 0.2, strata: 0.013, body: 0.6 });
  ridge(x => 0.035 + 0.012 * Math.sin(x * 5 + 2) + 0.006 * Math.sin(x * 17), { z: 1, bright: 0.3, tint: 0.8 });
  { const sx = 0.3, sr = 0.17;                                                               // the sun, half set, in bands
    for (let k = 0; k <= 90; k++) { const a = k / 90 * Math.PI, x = sx + Math.cos(a) * sr, y = Math.sin(a) * sr; if (y > top(x) + 0.003) put(key, x, y, 1.2, 5, 0.9, 1 - y / sr); }
    for (let y = 0.004; y < sr; y += 0.0058) {
      if (y < sr * 0.62 && Math.floor(y / 0.0116) % 2 === 1) continue;
      const hw = Math.sqrt(sr * sr - y * y);
      for (let x = sx - hw; x <= sx + hw; x += 0.0058) if (y > top(x) + 0.003) put(fill, x, y, 1.2, 0, 0.85, 1 - y / sr);
    } }
  floor();
  for (let k = 0; k <= 150; k++) { const t = k / 150, y = -0.55 * t;                         // the road to the horizon
    put(key, 0.3 - 0.55 * t, y, 0, 5, 0.5, 3); put(key, 0.3 + 0.066 * t, y, 0, 5, 0.5, 3);
    if (Math.floor(Math.sqrt(t) * 14) % 2 === 0) put(key, 0.3 - 0.242 * t, y, 0, 5, 0.6, 3); }
  { const cx = -0.5, cy = 0.46, r = 0.036, v = 0.004;                                        // a hot-air balloon; its phase is its speed
    for (let j = -11; j <= 8; j++) { const t = j / 8 * r, hw = t >= 0 ? Math.sqrt(r * r - t * t) : r * (1 - 0.8 * (-t / (1.375 * r)) ** 1.4), m = Math.max(1, Math.round(hw / 0.0026));
      for (let i = -m; i <= m; i++) put(key, cx + i / m * hw, cy + t, 1, 3, 0.85, Math.abs(i) % 4 < 2 ? 2 : 3, v); }
    for (let i = -2; i <= 2; i++) for (const dy of [0, 0.004]) put(key, cx + i * 0.0026, cy - 1.75 * r + dy, 1, 3, 0.8, 3, v); }
  return done(n);
}
// Manhattan at night from across the East River: the Brooklyn Bridge, One World Trade, the Empire State and Chrysler buildings,
// the thin towers of Billionaires' Row, and the Statue of Liberty out in the harbour.
function newYork(n) {
  const { rand, key, fill, put, line, tower, water, top, done, X0 } = sketch(113);
  const flat = h => () => h, mid = u => Math.abs(2 * u - 1);
  const env = x => (x < -0.5 ? 0.4 : Math.min(1.1, 0.7 + 0.4 * Math.exp(-(((x - 0.15) / 0.35) ** 2)) + 0.3 * Math.exp(-(((x + 0.38) / 0.1) ** 2))));   // low by the bridge, tallest in Midtown
  // the Brooklyn Bridge: two stone towers, the deck, the main cables and their suspenders
  { const deck = 0.034, tops = 0.115, t1 = -0.8, t2 = -0.6, cable = x => { const u = (x - t1) / (t2 - t1); return u < 0 ? lerp(deck, tops, (x + 1.02) / (t1 + 1.02)) : u > 1 ? lerp(tops, deck, (x - t2) / 0.16) : deck + 0.012 + (tops - deck - 0.012) * (2 * u - 1) ** 2; };
    line(X0, deck, -0.44, deck, { z: 0.1, bright: 0.9, tint: 3 }); line(X0, deck - 0.006, -0.44, deck - 0.006, { z: 0.1, bright: 0.45, tint: 3, step: 0.006 });
    for (let x = -1.02; x <= -0.44; x += 0.0028) put(key, x, cable(x), 0.1, 5, 0.9, 0.5);
    for (let x = -1.02; x <= -0.44; x += 0.011) for (let y = deck + 0.006; y < cable(x) - 0.003; y += 0.007) put(fill, x, y, 0.1, 0, 0.35, 0.5);
    for (const t of [t1, t2]) { for (const d of [-0.012, 0, 0.012]) line(t + d, 0.002, t + d, tops, { z: 0.1, bright: d ? 1 : 0.5, tint: 3 }); line(t - 0.014, tops, t + 0.014, tops, { z: 0.1, tint: 3 });
      for (const s of [-1, 1]) for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI; put(key, t + s * 0.006 + Math.cos(a) * 0.0045, 0.075 + Math.sin(a) * 0.012, 0.1, 5, 0.7, 3); } } }   // the pointed arches
  // the waterfront
  for (let x = -0.46; x < 1.1;) { const w = 0.018 + rand() * 0.03; tower(x + w / 2, w, flat((0.03 + rand() * 0.06) * env(x)), { z: 0.2, bright: 0.75, lit: 0.6, tint: rand() < 0.4 ? 3 : rand(), style: rand() < 0.3 ? 1 : 0 }); x += w + rand() * 0.006; }
  // the landmarks
  const L = { z: 0.5, bright: 0.95 };
  { const xc = -0.38, w = 0.062, h = 0.36;                                                    // One World Trade: eight tall triangles of glass and a spire
    tower(xc, w, flat(h), { ...L, tint: 0.85, lit: 0.3 });
    for (const s of [-1, 1]) { line(xc + s * w / 2, 0.07, xc, h, { tint: 0.85 }); line(xc, 0.07, xc + s * w / 2, h, { tint: 0.85, bright: 0.6 }); }
    line(xc, h, xc, 0.445, { tint: 0.85 }); put(key, xc, 0.45, 0.5, 4, 1, 2); }
  tower(-0.2, 0.05, u => 0.29 + 0.055 * u, { ...L, tint: 0.6, style: 1, bright: 0.8 });       // 30 Hudson Yards and its pointed deck
  line(-0.225, 0.262, -0.243, 0.268, { tint: 0.6 }); line(-0.243, 0.268, -0.225, 0.255, { tint: 0.6 });
  { const xc = 0.0, w = 0.09;                                                                 // the Empire State Building: setbacks, a mast, lit from the top down
    tower(xc, w, u => { const a = mid(u); return a > 0.82 ? 0.15 : a > 0.6 ? 0.26 : a > 0.38 ? 0.3 : a > 0.2 ? 0.325 : 0.34; }, { ...L, tint: 0.3, style: 1, bright: 1 });
    for (const [y, hw] of [[0.3, 0.017], [0.325, 0.009], [0.34, 0.009]]) line(xc - hw, y, xc + hw, y, { tint: 3 });
    for (const d of [-0.004, 0.004]) line(xc + d, 0.34, xc + d * 0.4, 0.375, { tint: 3 });
    line(xc, 0.375, xc, 0.415, { tint: 3 }); put(key, xc, 0.42, 0.5, 4, 1, 2); }
  tower(0.115, 0.046, u => 0.26 + 0.05 * u, { ...L, tint: 0.95, lit: 0.35, bright: 0.8 });     // the Bank of America Tower: faceted, with a spire
  line(0.134, 0.31, 0.134, 0.365, { tint: 0.95 }); put(key, 0.134, 0.37, 0.5, 4, 1, 2);
  { const xc = 0.225, w = 0.05, body = 0.245;                                                 // the Chrysler Building: a crown of arches and a needle
    tower(xc, w, u => body + 0.06 * (1 - mid(u) ** 1.5), { ...L, tint: 0.15, style: 1, bright: 0.9 });
    for (let k = 0; k < 4; k++) { const r = 0.02 - k * 0.0042, y0 = body + 0.004 + k * 0.014; for (let j = 0; j <= 10; j++) { const a = j / 10 * Math.PI; put(key, xc + Math.cos(a) * r, y0 + Math.sin(a) * r * 0.9, 0.5, 5, 1, 3); } }
    line(xc, body + 0.06, xc, 0.345, { tint: 3 }); put(key, xc, 0.35, 0.5, 4, 1, 2); }
  tower(0.32, 0.04, u => 0.2 + 0.055 * u, { ...L, tint: 0.5, style: 2, bright: 0.8 });         // the Citigroup Center's slanted roof
  tower(0.42, 0.02, flat(0.4), { ...L, tint: 0.7, style: 3, bright: 0.9 });                     // 432 Park Avenue: a plain grid
  tower(0.465, 0.013, u => 0.35 + 0.065 * u, { ...L, tint: 3, bright: 0.85 });                  // 111 West 57th: a feather of setbacks
  tower(0.515, 0.026, u => (u < 0.35 ? 0.395 : 0.44), { ...L, tint: 0.4, style: 1, bright: 0.9 });   // Central Park Tower
  // the rest of Midtown and downtown behind
  for (let x = -0.5; x < 1.1;) { const w = 0.016 + rand() * 0.028; tower(x + w / 2, w, flat((0.09 + rand() * 0.13) * env(x)), { z: 0.6, bright: 0.55, lit: 0.5, edge: 0.8, style: rand() < 0.25 ? 1 : rand() < 0.2 ? 2 : 0 }); x += w + rand() * 0.008; }
  for (let x = -0.5; x < 1.1;) { const w = 0.012 + rand() * 0.016; tower(x + w / 2, w, flat((0.12 + rand() * 0.13) * env(x)), { z: 0.8, bright: 0.36, lit: 0.42, edge: 0.7 }); x += w + rand() * 0.016; }
  water();
  { const x = 0.72, y = -0.07, o = { z: 0, bright: 1, tint: 0.2, step: 0.0028 };              // the Statue of Liberty on her island, torch raised
    line(x - 0.045, y, x + 0.045, y, o); line(x - 0.03, y + 0.006, x + 0.03, y + 0.006, { ...o, bright: 0.6 });
    for (const d of [-1, 1]) line(x + d * 0.014, y + 0.006, x + d * 0.009, y + 0.05, o);       // the pedestal
    line(x - 0.011, y + 0.05, x + 0.011, y + 0.05, o);
    for (const d of [-1, 1]) line(x + d * 0.008, y + 0.05, x + d * 0.004, y + 0.098, o);       // the robe
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; put(key, x + Math.cos(a) * 0.0042, y + 0.104 + Math.sin(a) * 0.0048, 0, 5, 1, 0.2); }   // the head
    for (const a of [0.5, 1.05, 1.57, 2.1, 2.65]) line(x + Math.cos(a) * 0.006, y + 0.105 + Math.sin(a) * 0.006, x + Math.cos(a) * 0.011, y + 0.105 + Math.sin(a) * 0.011, { ...o, step: 0.0025 });   // the crown
    line(x - 0.005, y + 0.09, x - 0.014, y + 0.128, o);                                        // the arm
    for (const [dx, dy] of [[0, 0], [-0.003, 0.004], [0.003, 0.004], [0, 0.008], [0, 0.004]]) put(key, x - 0.014 + dx, y + 0.132 + dy, 0, 5, 1, 3); }   // the torch
  { const x = -0.2, y = -0.035, v = 0.008, o = { z: 0, kind: 3, ph: v, step: 0.0024 };         // a ferry crossing; its phase is its speed
    line(x, y, x + 0.06, y, { ...o, bright: 0.9, tint: 3 }); line(x + 0.003, y + 0.0045, x + 0.057, y + 0.0045, { ...o, bright: 1, tint: 3 });
    line(x + 0.008, y + 0.009, x + 0.052, y + 0.009, { ...o, bright: 0.8, tint: 0.2 }); line(x + 0.03, y + 0.009, x + 0.03, y + 0.016, { ...o, bright: 0.8, tint: 0.2 }); }
  return done(n);
}
// Paris at night across the Seine: the Eiffel Tower sparkling, the Louvre pyramid, the Arc de Triomphe, Notre-Dame and
// Sacré-Cœur on its hill, over a low city of mansard roofs.
function paris(n) {
  const { rand, key, fill, put, line, tower, ridge, water, top, done, X0 } = sketch(211);
  const flat = h => () => h, mid = u => Math.abs(2 * u - 1);
  { const xc = -0.52, H = 0.4, hw = y => 0.0045 + 0.088 * Math.exp(-y / 0.075);               // the Eiffel Tower: four legs that sweep up into one
    for (let y = 0.002; y < H; y += 0.0028) for (const s of [-1, 1]) put(key, xc + s * hw(y), y, 0.3, 5, 1, 3);
    for (let k = 0; k <= 26; k++) { const a = k / 26 * Math.PI; put(key, xc + Math.cos(a) * 0.052, 0.002 + Math.sin(a) * 0.052, 0.3, 5, 0.9, 3); }   // the arch between the legs
    for (const [y, b] of [[0.062, 1], [0.066, 0.6], [0.128, 1], [0.132, 0.6], [0.335, 1]]) line(xc - hw(y) - 0.004, y, xc + hw(y) + 0.004, y, { z: 0.3, bright: b, tint: 3 });   // the three platforms
    for (let y = 0.07; y < 0.33;) { const d = Math.max(0.012, hw(y) * 1.5), y2 = Math.min(0.33, y + d);                 // the lattice
      line(xc - hw(y), y, xc + hw(y2), y2, { z: 0.3, bright: 0.6, tint: 3, step: 0.004 }); line(xc + hw(y), y, xc - hw(y2), y2, { z: 0.3, bright: 0.6, tint: 3, step: 0.004 }); y = y2; }
    for (const s of [-1, 1]) for (let y = 0.004; y < 0.06; y += 0.0045) { const o = hw(y), i = Math.sqrt(Math.max(0, 0.052 ** 2 - (y - 0.002) ** 2)); for (let x = i + 0.004; x < o - 0.002; x += 0.0055) put(fill, xc + s * x, y, 0.3, 0, 0.5, 3); }   // the legs
    for (let k = 0; k < 700; k++) { const y = 0.004 + rand() * (H - 0.01), x = (rand() * 2 - 1) * hw(y); if (y > 0.06 || Math.abs(x) > 0.055) put(fill, xc + x, y, 0.3, 1, 0.5 + 0.5 * rand(), 3); }   // it sparkles on the hour
    line(xc, H, xc, 0.44, { z: 0.3, tint: 3 }); put(key, xc, 0.445, 0.3, 4, 1, 2); }
  { const xc = -0.16, w = 0.075, h = 0.042;                                                   // the Louvre's glass pyramid
    for (const s of [-1, 1]) line(xc + s * w / 2, 0.003, xc, h, { z: 0.2, tint: 0.2 });
    for (let k = 1; k < 5; k++) { const y = h * k / 5, q = (1 - k / 5) * w / 2; line(xc - q, y, xc + q, y, { z: 0.2, bright: 0.45, tint: 0.2, step: 0.005 }); }
    for (const q of [-0.5, 0, 0.5]) line(xc + q * w / 2, 0.003, xc, h, { z: 0.2, bright: 0.4, tint: 0.2, step: 0.005 }); }
  { const xc = 0.1, w = 0.085, h = 0.085, o = { z: 0.3, tint: 3 };                            // the Arc de Triomphe
    for (const s of [-1, 1]) { line(xc + s * w / 2, 0.003, xc + s * w / 2, h, o); line(xc + s * 0.016, 0.003, xc + s * 0.016, 0.04, o); }
    for (const y of [h, h - 0.006, h - 0.02, h - 0.025]) line(xc - w / 2, y, xc + w / 2, y, { ...o, bright: y === h ? 1 : 0.6 });
    for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI; put(key, xc + Math.cos(a) * 0.016, 0.04 + Math.sin(a) * 0.016, 0.3, 5, 1, 3); }
    for (const s of [-1, 1]) for (let y = 0.008; y < h - 0.028; y += 0.006) for (let x = 0.021; x < w / 2 - 0.003; x += 0.0055) if (rand() < 0.6) put(fill, xc + s * x, y, 0.3, 0, 0.45, 3); }
  { const x = 0.33, o = { z: 0.4, tint: 0.75 };                                               // Notre-Dame: two towers, the nave and its spire
    tower(x, 0.02, flat(0.085), { ...o, bright: 0.9, style: 1 }); tower(x + 0.026, 0.02, flat(0.085), { ...o, bright: 0.9, style: 1 });
    tower(x + 0.013, 0.012, flat(0.055), { ...o, bright: 0.7 }); tower(x + 0.075, 0.08, u => 0.05 + 0.012 * (1 - mid(u)), { ...o, bright: 0.7, style: 2 });
    line(x + 0.085, 0.06, x + 0.085, 0.112, o); for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2; put(key, x + 0.013 + Math.cos(a) * 0.006, 0.04 + Math.sin(a) * 0.006, 0.4, 5, 0.9, 3); } }   // the rose window
  // mansard roofs along the river, then the city behind
  for (let x = X0; x < 1.1;) { const w = 0.03 + rand() * 0.04, h = 0.026 + rand() * 0.02; tower(x + w / 2, w, u => h + (mid(u) < 0.86 ? 0.007 : 0), { z: 0.2, bright: 0.6, lit: 0.55, tint: rand() < 0.6 ? 3 : rand(), edge: 0.8 }); x += w + rand() * 0.004; }
  { const hill = x => 0.03 + 0.085 * Math.exp(-(((x - 0.66) / 0.2) ** 2)), xc = 0.66, b = hill(0.66) - 0.004, o = { z: 0.9, tint: 0.55, bright: 0.8, lit: 0.3 };   // Sacré-Cœur on the hill of Montmartre
    const dome = (h, r) => u => b + h + r * Math.sqrt(Math.max(0, 1 - mid(u) ** 2)) * 1.5;
    tower(xc, 0.03, dome(0.022, 0.02), o); tower(xc - 0.026, 0.014, dome(0.016, 0.009), o); tower(xc + 0.026, 0.014, dome(0.016, 0.009), o);
    tower(xc + 0.052, 0.009, u => b + 0.04 + 0.012 * (1 - mid(u)), o); tower(xc, 0.075, flat(b + 0.018), o);
    line(xc, b + 0.052, xc, b + 0.064, { z: 0.9, tint: 0.55 });
    for (let x = X0; x < 1.1;) { const w = 0.02 + rand() * 0.03; tower(x + w / 2, w, flat(0.035 + rand() * 0.03 + (hill(x) - 0.03) * 0.5), { z: 0.6, bright: 0.4, lit: 0.45, tint: rand() < 0.5 ? 3 : rand(), edge: 0.7 }); x += w + rand() * 0.01; }
    ridge(hill, { z: 1, bright: 0.3, tint: 0.5, levels: [0.6, 0.85], body: 0.5 }); }
  for (let x = 0.5; x < 0.62; x += 0.005) for (let y = 0.44; y < 0.56; y += 0.005)             // the moon
    if (Math.hypot(x - 0.56, y - 0.5) < 0.055 && Math.hypot(x - 0.585, y - 0.515) > 0.05) put(key, x, y, 1.3, 5, 1, 0.5);
  water();
  { const x = 0.3, y = -0.045, v = -0.007, o = { z: 0, kind: 3, ph: v, step: 0.0024 };         // a bateau-mouche on the Seine
    line(x, y, x + 0.08, y, { ...o, bright: 0.9, tint: 0.2 }); line(x + 0.004, y + 0.0045, x + 0.076, y + 0.0045, { ...o, bright: 1, tint: 3 }); line(x + 0.01, y + 0.009, x + 0.07, y + 0.009, { ...o, bright: 0.7, tint: 0.2 }); }
  return done(n);
}
const cloud = (() => {
  const M = LOW ? 64000 : 150000, GOLD = Math.PI * (3 - Math.sqrt(5));
  const pos = [], rnd = [], land = [];
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // seeded: the same sky on every visit
  for (let i = 0; i < M; i++) {                                                          // evenly spread points; keep the ones on land, and a few at sea
    const y = 1 - 2 * (i + 0.5) / M, lat = Math.asin(y) * 180 / Math.PI, lon = ((i * GOLD * 180 / Math.PI) % 360 + 360) % 360 - 180;
    const on = isLand(lat, lon);
    if (!on && rand() > 0.07) continue;
    const p = ll(lat, lon, R * 1.004);
    pos.push(p.x, p.y, p.z); rnd.push(rand(), rand(), rand(), rand()); land.push(on ? 1 : 0);
  }
  const n = land.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 4));
  g.setAttribute('aLand', new THREE.Float32BufferAttribute(land, 1));
  const hk = harbour(n);
  g.setAttribute('aCity', new THREE.BufferAttribute(hk.at, 3)); g.setAttribute('aCk', new THREE.BufferAttribute(hk.as, 4));
  const dz = desert(n), ny = newYork(n), pa = paris(n);
  g.setAttribute('aDes', new THREE.BufferAttribute(dz.at, 3)); g.setAttribute('aDk', new THREE.BufferAttribute(dz.as, 4));
  g.setAttribute('aNyc', new THREE.BufferAttribute(ny.at, 3)); g.setAttribute('aNk', new THREE.BufferAttribute(ny.as, 4));
  g.setAttribute('aPar', new THREE.BufferAttribute(pa.at, 3)); g.setAttribute('aPk', new THREE.BufferAttribute(pa.as, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: cloudU, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aRnd; attribute float aLand; attribute vec3 aCity,aDes,aNyc,aPar; attribute vec4 aCk,aDk,aNk,aPk;
      uniform vec3 uHP,uDP,uNP,uPP; uniform float uTime,uG,uH,uD,uN,uP,uScroll,uScale,uPx,uAspect,uRepel; uniform vec2 uMouse; uniform vec3 uA,uB;
      varying vec3 vCol; varying float vAl;
      float stag(float u,float r){ float q=clamp(u*1.7-r*.7,0.,1.); return q*q*(3.-2.*q); }   // each point sets off at its own moment
      // a drawn scene (the harbour, the desert, New York, Paris). c = x, y, depth (0 near .. 1 far); k = kind, brightness, tint, phase;
      // s = the part that is centred, the height of the horizon, the size. Gives the point's place, colour, brightness and size.
      vec3 scene(vec3 c,vec4 k,vec3 s,out vec3 col,out float al,out float sz){
        float kd=k.x, isWater=step(.5,kd)*step(kd,1.5), isBoat=step(2.5,kd)*step(kd,3.5);
        vec2 b=c.xy;
        b.x=mix(b.x,mod(b.x+uTime*k.w+1.2,2.4)-1.2,isBoat);                                  // boats (and the balloon) cross the view and come round again
        b.y+=isBoat*sin(uTime*.9+k.w*300.)*.0012;
        b.x+=isWater*sin(uTime*(.5+k.w)+k.w*50.+b.y*90.)*(.0015+.009*clamp(-b.y*4.,0.,1.));   // reflections waver, more so nearer the viewer
        b.x-=uMouse.x*.012*c.z;                                                               // far things shift a little against near ones
        col=k.z<1.5?mix(uA,uB,k.z):(k.z<2.5?vec3(1.,.2,.3):vec3(1.,.74,.4));                   // section colours, or red (sails, warning lights) or amber
        col=mix(col,vec3(1.),kd<.5?.3:kd<1.5?.15:kd<2.5?.6:kd<3.5?.25:kd<4.5?0.:.48);
        float fl=kd<.5?.82+.18*sin(uTime*(.3+aRnd.x)+aRnd.z*60.)                               // windows glow steadily
          :kd<1.5?.55+.45*sin(uTime*(1.+aRnd.x*2.)+aRnd.z*60.)                                 // water glitters
          :kd<2.5?.75+.25*sin(uTime*(1.+aRnd.y*2.)+aRnd.x*60.)                                 // stars twinkle
          :kd<3.5?1.:kd<4.5?step(.5,fract(uTime*.5+k.w)):1.;                                   // warning lights blink
        al=min(1.,k.y*1.25)*fl; sz=(.009+.009*k.y)*s.z*.22;
        return vec3((b.x-s.x)*s.z,s.y+b.y*s.z,0.);
      }
      void main(){
        float gi=stag(uG,aRnd.w), hi=stag(uH,aRnd.y), qi=stag(uD,aRnd.x), ri=stag(uN,aRnd.z), ti=stag(uP,aRnd.y);
        float tot=max(1.,gi+hi+qi+ri+ti); gi/=tot; hi/=tot; qi/=tot; ri/=tot; ti/=tot;       // a point between two shapes is never pulled past either
        float di=clamp(1.-gi-hi-qi-ri-ti,0.,1.);
        // the Earth
        vec3 e=(modelMatrix*vec4(position,1.)).xyz;
        vec3 wn=normalize(mat3(modelMatrix)*position);
        float facing=dot(wn,normalize(cameraPosition-e));
        float lit=.42+.78*smoothstep(-.35,.7,dot(wn,normalize(vec3(-.55,.5,.65))));        // day side, night side
        // the star field: drifts on its own, and streams past as the page scrolls
        vec3 d=(aRnd.xyz-.5)*vec3(34.,22.,17.); d.z-=5.5;
        d.y=mod(d.y+uScroll*(.6+aRnd.w*1.6)+11.,22.)-11.;
        d.x+=sin(uTime*.07+aRnd.w*40.)*.5; d.y+=cos(uTime*.05+aRnd.x*40.)*.3;
        // the drawn scenes: Victoria Harbour, the Arizona desert, New York, Paris
        vec3 cH,cQ,cR,cT; float aH,aQ,aR,aT,sH,sQ,sR,sT;
        vec3 hp=scene(aCity,aCk,uHP,cH,aH,sH), qp=scene(aDes,aDk,uDP,cQ,aQ,sQ), rp=scene(aNyc,aNk,uNP,cR,aR,sR), tp=scene(aPar,aPk,uPP,cT,aT,sT);
        vec3 p=e*gi+d*di+hp*hi+qp*qi+rp*ri+tp*ti;
        float tr=4.*(gi*(1.-gi)+hi*(1.-hi)+qi*(1.-qi)+ri*(1.-ri)+ti*(1.-ti));                                                // mid-flight: a little turbulence
        p+=tr*.55*vec3(sin(aRnd.x*50.+uTime*.7),cos(aRnd.y*50.+uTime*.6),sin(aRnd.z*50.+uTime*.5));
        vec4 mv=viewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*mv;
        // the pointer pushes nearby points aside
        vec2 dm=(gl_Position.xy/gl_Position.w-uMouse)*vec2(uAspect,1.); float f=exp(-dot(dm,dm)*22.)*uRepel;
        gl_Position.xy+=normalize(dm+1e-5)/vec2(uAspect,1.)*f*.07*gl_Position.w;
        // size
        float star=pow(aRnd.w,11.);                                                      // most stars are faint; a few are bright
        float sE=mix(.0085,.0165,aLand)*uScale*(1.+step(.965,aRnd.x)*.9);
        float sD=.017+star*.055;
        float ps=(sE*gi+sD*di+sH*hi+sQ*qi+sR*ri+sT*ti)*uPx/-mv.z;
        gl_PointSize=max(ps,1.6);
        // colour and brightness
        vec3 grad=mix(uB,uA,smoothstep(-.9,.9,wn.y+.35*sin(wn.x*3.+uTime*.2)));
        vec3 cE=mix(grad,vec3(1.),.42+.5*step(.965,aRnd.x))*lit;
        float aE=mix(.2,1.,aLand)*mix(.05,1.,smoothstep(-.3,.3,facing))*(1.+.6*pow(1.-abs(facing),3.));
        float tw=.75+.25*sin(uTime*(1.+aRnd.y*2.)+aRnd.x*60.);
        vec3 cD=mix(mix(uA,uB,aRnd.y),vec3(1.),.55+.4*star);
        float aD=(.02+.85*star)*tw*smoothstep(3.,8.,-mv.z);                                   // nothing looms right in front of the lens
        vCol=(cE*gi+cD*di+cH*hi+cQ*qi+cR*ri+cT*ti)*(1.+f*1.6);
        vAl=(aE*gi+aD*di+aH*hi+aQ*qi+aR*ri+aT*ti)*min(1.,ps/1.6);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vAl;
      void main(){
        float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.12,d);
        gl_FragColor=vec4(vCol,a*vAl);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 2; globe.add(pts);
  return pts;
})();

// two beacons on the Earth: where the story starts and where it is now
const CITIES = [{ code: 'PHX', at: PHX, txt: '33.45°N 112.07°W' }, { code: 'HKG', at: HKG, txt: '22.32°N 114.17°E' }];
const beacons = (() => {
  const g = new THREE.BufferGeometry().setFromPoints(CITIES.map(c => ll(c.at[0], c.at[1], R * 1.012)));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uA: uniforms.uA, uShow: uniforms.uShow, uScale: cloudU.uScale, uPx: cloudU.uPx },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uScale,uPx; varying float vF;
      void main(){ vec3 e=(modelMatrix*vec4(position,1.)).xyz; vF=dot(normalize(mat3(modelMatrix)*position),normalize(cameraPosition-e));
        vec4 mv=viewMatrix*vec4(e,1.); gl_Position=projectionMatrix*mv; gl_PointSize=.2*uScale*uPx/-mv.z; }`,
    fragmentShader: /* glsl */`
      uniform float uTime,uShow; uniform vec3 uA; varying float vF;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float ph=fract(uTime*.45);
        float ring=smoothstep(.07,0.,abs(d-ph*.92))*(1.-ph);                                // a ring that widens and fades
        float core=smoothstep(.2,.04,d);
        gl_FragColor=vec4(mix(uA,vec3(1.),.7),(core+ring*.9)*smoothstep(-.05,.3,vF)*uShow);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3; globe.add(pts);
  return pts;
})();
const geo = document.createElement('div'); geo.className = 'geo'; geo.setAttribute('aria-hidden', 'true');
geo.innerHTML = CITIES.map(c => `<span class="geo__tag"><b>${c.code}</b><i>${c.txt}</i></span>`).join('');
canvas.after(geo);
const geoTags = [...geo.children], geoLocal = CITIES.map(c => ll(c.at[0], c.at[1], R * 1.03)), geoV = new THREE.Vector3(), geoN = new THREE.Vector3();

// backdrop: a slow nebula in the section's colours, behind everything
const nebulaMat = new THREE.ShaderMaterial({
  uniforms: { uTime: uniforms.uTime, uA: uniforms.uA, uB: uniforms.uB, uScroll: cloudU.uScroll, uAspect: cloudU.uAspect, uMouse: cloudU.uMouse },
  transparent: true, depthWrite: false, depthTest: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,1.,1.); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uA,uB; uniform float uTime,uScroll,uAspect; uniform vec2 uMouse; varying vec2 vUv;
    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
    float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
    void main(){
      vec2 p=(vUv-.5)*vec2(uAspect,1.)*1.9; p.y+=uScroll*.12; p+=uMouse*.05;
      float t=uTime*.025;
      vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
      float n=fbm(p+q*1.7+t*.6);
      float m=smoothstep(.36,.82,n);
      vec3 col=mix(uB,uA,smoothstep(.25,.75,q.x));
      float vig=smoothstep(1.25,.15,length((vUv-.5)*vec2(1.1,1.5)));
      float a=m*(.1+.2*vig)+(hash(vUv*913.)-.5)*.012;                                       // a little grain hides banding
      gl_FragColor=vec4(col,clamp(a,0.,1.));
      #include <colorspace_fragment>
    }`,
});
const nebula = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebulaMat); nebula.frustumCulled = false; nebula.renderOrder = -10; scene.add(nebula);

/* Sizing */
let maxDpr = LOW ? 1.5 : 2;   // lowered while running if the frame rate can't keep up (see the render loop)
function resize() {
  if (!renderer) return;
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(devicePixelRatio, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  cloudU.uAspect.value = camera.aspect;
  cloudU.uPx.value = h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));   // pixels per world unit, one unit away
}
addEventListener('resize', resize); resize();

/* Input */
addEventListener('pointermove', e => {
  state.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  cursor.x = e.clientX; cursor.y = e.clientY;
  if (e.pointerType === 'mouse' && !reduced) cloudU.uRepel.value = 1;
}, { passive: true });
addEventListener('scroll', () => { state.scroll = scrollY; }, { passive: true });

/* ---------- Section themes ---------- */
const sections = $$('[data-theme]');
function setTheme(i) {
  if (i === state.theme && target.a.getHex()) return;
  state.theme = i;
  const t = THEMES[i];
  target.a.set(t.a); target.b.set(t.b);
  document.body.style.setProperty('--accent', '#' + new THREE.Color(t.a).offsetHSL(0, 0, 0.14).getHexString()); document.body.style.setProperty('--accent2', '#' + new THREE.Color(t.b).offsetHSL(0, 0, 0.08).getHexString());   // lightened so they read on black
}
target.a.set(cur.a); target.b.set(cur.b);
sections.forEach(s => {
  new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setTheme(+s.dataset.theme)), { rootMargin: '-45% 0px -45% 0px' }).observe(s);
});

/* ---------- Scroll journey: the globe's layout is interpolated between the sections' keyframes ---------- */
let jKeys = [];
function measureJourney() {
  jKeys = sections.map(el => { const r = el.getBoundingClientRect(); return { c: r.top + scrollY + r.height / 2, k: THEMES[+el.dataset.theme] }; }).sort((a, b) => a.c - b.c);
}
measureJourney(); addEventListener('resize', measureJourney); setInterval(measureJourney, 1000);
(document.fonts?.ready ?? Promise.resolve()).then(measureJourney);
function journeyAt(probe) {                                     // -> { a, b, w }: the two keyframes around the probe line and how far between them
  const n = jKeys.length;
  if (probe <= jKeys[0].c) return { a: jKeys[0].k, b: jKeys[0].k, w: 0 };
  if (probe >= jKeys[n - 1].c) return { a: jKeys[n - 1].k, b: jKeys[n - 1].k, w: 0 };
  let i = 0; while (jKeys[i + 1].c < probe) i++;
  const u = (probe - jKeys[i].c) / (jKeys[i + 1].c - jKeys[i].c);
  return { a: jKeys[i].k, b: jKeys[i + 1].k, w: sm(0.2, 0.8, u) };   // holds near each section, moves in between
}
let ringBoost = 0, gS = 0, hS = 0, dS = 0, nS = 0, pS = 0, introV = 0, introGo = false;

/* ---------- Render loop ---------- */
const clock = new THREE.Clock();
const mouse3 = new THREE.Vector3();
let slowN = 0, slowT = 0;
let gait = 1.92, spin = 0.1, globeScale = 1;   // starts over the Pacific, Hong Kong coming into view
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta(), dt = Math.min(rawDt, 0.05); const t = clock.elapsedTime;
  state.smooth.lerp(state.mouse, 1 - Math.pow(0.001, dt));
  state.smoothScroll = lerp(state.smoothScroll, state.scroll, 1 - Math.pow(0.0005, dt));
  const vel = state.scroll - state.smoothScroll;

  cursorLoop();
  if (!renderer) return;
  // if this machine can't hold a decent frame rate at full sharpness, render fewer pixels
  if (introV >= 1 && !document.hidden && maxDpr > 1) {
    slowN++; slowT += Math.min(rawDt, 0.1);   // one long gap (a background tab) must not count as a slow machine
    if (slowN >= 120) { if (slowT / slowN > 1 / 40) { maxDpr = Math.max(1, maxDpr - 0.5); resize(); } slowN = 0; slowT = 0; }
  }

  // colour + layout tween
  const kc = 1 - Math.pow(0.12, dt);                         // slower, softer colour change between sections
  colors.a.lerp(target.a, kc); colors.b.lerp(target.b, kc);
  const aspect = camera.aspect, mobile = aspect < 0.8;
  const visH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z, visW = visH * aspect;   // half-height / half-width visible at the globe's depth
  const U = Math.min(visH, visW * 1.2);                                                                         // the window's shorter side, used to size the globe
  const jr = journeyAt(state.smoothScroll + innerHeight * 0.5), kf = f => lerp(jr.a[f], jr.b[f], jr.w);
  const bleed = kf('bleed');
  // what the cloud forms follows the scroll journey; on arrival it gathers out of the star field
  if (introGo) introV = Math.min(1, introV + dt / (reduced ? 0.01 : 2.6));
  const intro = introV * introV * (3 - 2 * introV), km = 1 - Math.pow(0.02, dt);
  gS = lerp(gS, kf('g') * intro, km); hS = lerp(hS, kf('h') * intro, km); dS = lerp(dS, mobile ? 0 : kf('d') * intro, km);   // phones keep the stars behind the project list and the timeline: a scene would sit under small text
  nS = lerp(nS, kf('n') * intro, km); pS = lerp(pS, mobile ? 0 : kf('p') * intro, km);
  cloudU.uG.value = gS; cloudU.uH.value = hS; cloudU.uD.value = dS; cloudU.uN.value = nS; cloudU.uP.value = pS;
  const sceneS = Math.max(visW * 1.2, visH * 1.45);                                           // a drawn scene runs a little past the window's sides; narrow windows see its middle
  cloudU.uHP.value.set(mobile ? 0.17 : 0, visH * (mobile ? -0.05 : -0.24), sceneS);            // phones: Central
  cloudU.uDP.value.set(0, visH * -0.2, sceneS);
  cloudU.uNP.value.set(mobile ? 0.1 : 0, visH * (mobile ? -0.1 : -0.3), sceneS);               // phones: the Empire State and Chrysler buildings
  cloudU.uPP.value.set(0, visH * -0.34, sceneS);
  cloudU.uScroll.value = state.smoothScroll / innerHeight * 2.2;
  const show = sm(0.72, 1, gS); uniforms.uShow.value = show;      // the body, rings and arcs arrive once the points have landed
  for (const o of [coreMesh, halo, edgeHalo, ring1.g, ring2.g, beacons]) o.visible = show > 0.004;
  ringLineMats.forEach(m => { m.opacity = 0.55 * show; }); nodeMats.forEach(m => { m.opacity = 0.32 * show; });
  const rBody = kf('r') * (mobile ? lerp(1.5, 0.82, bleed) : 1);                                                // phones: small mid-page, large at the ends
  const scWant = rBody * U / R;
  const RING = 2.4, FIT = 0.97;
  const scFit = Math.min(scWant, Math.min(visW, visH) * FIT / RING);                                            // never larger than the window...
  const scT = lerp(scFit, scWant, bleed);                                                                       // ...except in the oversized sections
  const ks = 1 - Math.pow(0.0008, dt);
  globeScale = lerp(globeScale, scT, ks);
  blob.scale.setScalar(globeScale);
  const ext = RING * globeScale, limX = Math.max(0, visW * FIT - ext), limY = Math.max(0, visH * FIT - ext);
  const wantX = mobile ? 0 : kf('x') * visW, wantY = (mobile ? kf('my') : kf('y')) * visH;
  blob.position.x = lerp(blob.position.x, lerp(clamp(wantX, -limX, limX), wantX, bleed), ks);
  blob.position.y = lerp(blob.position.y, lerp(clamp(wantY, -limY, limY), wantY, bleed), ks);
  blob.rotation.z = lerp(blob.rotation.z, kf('tilt'), ks);
  blob.rotation.y = state.smooth.x * 0.5;
  blob.rotation.x = -state.smooth.y * 0.12;
  // slow rotation; speeds up while scrolling
  spin = lerp(spin, 0.1 + Math.min(Math.abs(vel) * 0.003, 0.8), 1 - Math.pow(0.1, dt));   // eased, no jumps
  gait += dt * spin;
  globe.rotation.y = gait + state.smoothScroll * 0.0009 - (1 - intro) * 1.6; globe.rotation.x = 0.35;     // the globe also turns with the page as you scroll, and spins into place on arrival
  ringBoost = lerp(ringBoost, reduced ? 0 : Math.min(Math.abs(vel) * 0.004, 0.3), 1 - Math.pow(0.05, dt));   // the rings open up while you scroll fast
  ring1.g.scale.setScalar(1 + ringBoost); ring2.g.scale.setScalar(1 + ringBoost * 1.5);
  ring1.g.rotation.y = gait * 0.5; ring2.g.rotation.x = 0.5 + gait * 0.35;
  // orbit spheres: steady, time-based speed, faster and unaffected by scroll
  for (const r of [ring1, ring2]) { const a = t * (r === ring1 ? 0.6 : -0.42); r.n.position.set(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 0); r.n2.position.set(Math.cos(Math.PI - a) * r.radius, Math.sin(Math.PI - a) * r.radius, 0); }   // second sphere circles the other way
  updateArcs(t, dt);
  for (const ar of arcs) for (const rn of ar.runners) {
    const cyc = (((t * 0.28 + ar.off + rn.off) % 1) + 1) % 1, TRAVEL = 0.62;               // one trip, then a pause
    if (cyc > TRAVEL || show < 0.004) { rn.head.visible = false; rn.comet.visible = false; rn.glow.visible = false; continue; }      // landed: dot and trail are removed until the next trip
    const u = cyc / TRAVEL, f0 = rn.dir > 0 ? u : 1 - u;                                    // reverse runners count down the arc
    const f = f0 * f0 * (3 - 2 * f0), fp = f * SEG, i0 = Math.min(Math.floor(fp), SEG - 1);  // eased start/finish
    rn.head.visible = true; rn.comet.visible = true; rn.glow.visible = true;                                                                 // the dot and its trail show for the trip
    rn.head.position.copy(ar.pts[i0]).lerp(ar.pts[Math.min(i0 + 1, SEG)], fp - i0);
    rn.head.scale.setScalar(Math.max(0.001, sm(0, 0.07, u) * (1 - sm(0.93, 1, u))));         // pops in as it sets off, shrinks away as it lands
    const trail = Math.round(TRAIL * (1 - sm(0.78, 1, u)));                                  // the trail retracts as the dot arrives
    const s0 = rn.dir > 0 ? Math.max(0, i0 - trail) : i0, s1 = rn.dir > 0 ? Math.min(i0 + 1, SEG + 1) : Math.min(i0 + 1 + trail, SEG + 1);   // trail sits behind the dot
    rn.comet.geometry.setDrawRange(s0, s1 - s0 + 1);
    const ca = rn.comet.geometry.attributes.color, span = Math.max(1, s1 - s0);
    for (let k = s0; k <= s1; k++) { const q = rn.dir > 0 ? (k - s0) / span : (s1 - k) / span; ca.setW(k, Math.pow(q, 1.05)); }   // head = 1, tail = 0
    ca.needsUpdate = true;
  }
  dynA.copy(colors.a).offsetHSL(0.08 * Math.sin(t * 0.22), 0, 0); dynB.copy(colors.b).offsetHSL(0.08 * Math.sin(t * 0.22 + 2.1), 0, 0);   // slow, gentle hue drift
  edgeHalo.rotation.set(-blob.rotation.x, -blob.rotation.y, 0);   // keep the halo facing the camera
  uniforms.uTime.value = reduced ? 0 : t;

  renderer.render(scene, camera);

  // city labels follow their beacons, and hide on the far side
  geoTags.forEach((el, i) => {
    geoV.copy(geoLocal[i]).applyMatrix4(globe.matrixWorld);
    geoN.copy(geoV).sub(blob.position).normalize();
    const facing = geoN.dot(mouse3.copy(camera.position).sub(geoV).normalize());
    geoV.project(camera);
    el.style.opacity = (sm(0.1, 0.4, facing) * show).toFixed(3);
    el.style.transform = `translate3d(${((geoV.x + 1) / 2 * innerWidth).toFixed(1)}px,${((1 - geoV.y) / 2 * innerHeight).toFixed(1)}px,0)`;
  });
}

/* ---------- Cursor ---------- */
const cursorEl = $('#cursor'), cursorLabel = $('#cursorLabel');
const cursor = { x: innerWidth / 2, y: innerHeight / 2, rx: innerWidth / 2, ry: innerHeight / 2 };
const trDot = $('#trDot');
function cursorLoop() {
  cursor.rx = lerp(cursor.rx, cursor.x, 0.2); cursor.ry = lerp(cursor.ry, cursor.y, 0.2);
  cursorEl.style.transform = `translate3d(${cursor.rx}px,${cursor.ry}px,0)`;                        // ring lags behind...
  trDot.style.transform = `translate3d(${cursor.x - cursor.rx}px,${cursor.y - cursor.ry}px,0)`;     // ...the dot stays exactly on the pointer
}
addEventListener('pointerdown', () => cursorEl.classList.add('down'));
addEventListener('pointerup', () => cursorEl.classList.remove('down'));
document.addEventListener('pointerover', e => {
  const el = e.target.closest?.('[data-cursor]');
  cursorEl.classList.remove('hover', 'view');
  cursorLabel.textContent = '';
  if (el) { const m = el.dataset.cursor; cursorEl.classList.add(m); if (m === 'view') cursorLabel.textContent = el.dataset.label || T.view; }
});

/* ---------- Work preview ---------- */
const preview = $('#preview');
let px = innerWidth / 2, py = innerHeight / 2;
$$('#workList a').forEach(a => {
  a.addEventListener('pointerenter', () => {
    preview.className = 'work__preview show ' + a.dataset.g;
    preview.innerHTML = `<div class="pv"><span class="pv__n">${$('.num', a).textContent} / ${$('.tag', a).textContent}</span><strong class="pv__name">${$('.name', a).textContent}</strong><p class="pv__d">${a.dataset.desc || ''}</p><span class="pv__go">${T.openLive}</span></div>`;
    preview.style.setProperty('--r', (Math.random() * 8 - 4).toFixed(1) + 'deg');
  });
  a.addEventListener('pointerleave', () => { preview.classList.remove('show'); });
});
(function followPreview() {
  const ox = px;
  px = lerp(px, cursor.x + 40, 0.12); py = lerp(py, cursor.y, 0.12);
  preview.style.left = px + 'px'; preview.style.top = py + 'px';
  preview.style.setProperty('--lean', clamp((px - ox) * 0.35, -12, 12).toFixed(2) + 'deg');   // it swings as it is carried
  requestAnimationFrame(followPreview);
})();

/* ---------- Text + reveal ---------- */
$$('.hero__title .line').forEach((l, i) => {
  l.innerHTML = `<span style="transition-delay:${0.15 + i * 0.12}s">${l.innerHTML}</span>`;
});
const words = $('.split-words');
// playful treatments for a few key words, matched by the word with punctuation stripped
const FUN = { 'designer‑engineer': 'f-grad', code: 'f-pill', craft: 'f-mark', playful: 'f-sticker', 'high‑performance': 'f-italic', websites: 'f-mark2', explore: 'f-select', shader: 'f-outline', easing: 'f-italic', pixel: 'f-bounce' };
if (CJK) {
  // Chinese has no spaces between words: split with the browser's word segmenter (one
  // character each where it isn't available). Highlighted words are marked in the
  // translation as <span data-fun="…">, since they can't be matched by their English text.
  const seg = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const parts = [];
  words.childNodes.forEach(n => {
    if (n.nodeType === 1 && n.dataset.fun) { parts.push(`<span class="w ${n.dataset.fun}">${n.textContent}</span>`); return; }
    const text = n.textContent.replace(/\s+/g, '');
    const pieces = seg ? [...seg.segment(text)].map(x => x.segment) : [...text];
    pieces.forEach(p => parts.push(`<span class="w">${p}</span>`));
  });
  words.innerHTML = parts.join('');
} else {
  words.innerHTML = words.textContent.trim().split(/\s+/).map(w => {
    const key = w.replace(/[.,;:—!?]/g, '').toLowerCase();
    const m = FUN[key] && w.match(/^(.*?)([.,;:!?]+)$/);                  // keep trailing punctuation outside a word's highlight
    if (m) return `<span class="w ${FUN[key]}">${m[1]}</span><span class="w">${m[2]}</span>`;
    return `<span class="w${FUN[key] ? ' ' + FUN[key] : ''}">${w}</span>`;
  }).join(' ');
}
const wordEls = $$('.w', words);
function updateWords() {
  const r = words.getBoundingClientRect();
  const p = clamp((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35), 0, 1);
  const n = Math.floor(p * wordEls.length * 1.05);
  wordEls.forEach((w, i) => w.classList.toggle('on', i < n));
}
addEventListener('scroll', updateWords, { passive: true }); updateWords();

const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; e.target.classList.add('in'); io.unobserve(e.target);
  if (e.target.matches('.eyebrow:not(.eyebrow--plain)')) decode(e.target);
}), { threshold: 0.2 });
$$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 4) * 0.08 + 's'; io.observe(el); });

/* ---------- Terminal typing: the command, then the paragraph, character by character ---------- */
const term = $('.term');
if (term) {
  const caret = $('.term__caret', term), tw = $('.tw', term);
  const wrapChars = (el, bucket) => { const txt = el.textContent; el.textContent = ''; for (const c of txt) { const sp = document.createElement('span'); sp.className = 'ch'; sp.textContent = c; el.appendChild(sp); bucket.push(sp); } };
  const cmdChars = []; wrapChars(tw, cmdChars);
  // the paragraph's words keep their playful styling; each word's letters become typeable
  const textChars = [];
  wordEls.forEach((w, i) => { wrapChars(w, textChars); const last = textChars[textChars.length - 1]; if (!CJK && i < wordEls.length - 1) last.dataset.gap = '1'; });
  const endPrompt = $('.term__end', term);
  term.querySelector('.term__cmd').appendChild(caret);   // the caret starts on the command line
  const finish = () => { term.classList.remove('typing'); term.classList.add('done'); endPrompt.appendChild(caret); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function typeAll() {
    term.classList.add('typing');
    await wait(250);
    for (const ch of cmdChars) { ch.classList.add('t'); ch.after(caret); await wait(30 + Math.random() * 30); }
    await wait(250);                                               // "press enter"
    for (const ch of textChars) {
      ch.classList.add('t'); ch.parentElement.classList.add('started'); ch.after(caret);   // a word's styling switches on when its first letter is typed
      const c = ch.textContent;
      // Quick enough to read in passing (about 2 s for the paragraph), with a human rhythm.
      let d = 1 + Math.random() * 3;
      if (/[.,;—]/.test(c)) d += 40 + Math.random() * 40;          // a beat at punctuation
      await wait(d);
    }
    await wait(250); finish();
  }
  const reveal = () => { cmdChars.concat(textChars).forEach(ch => { ch.classList.add('t'); ch.parentElement.classList.add('started'); }); finish(); };
  if (reduced) reveal();
  else new IntersectionObserver((es, ob) => es.forEach(e => { if (e.isIntersecting) { ob.disconnect(); typeAll(); } }), { threshold: 0.45 }).observe(term);
}

/* ---------- Split text: words rise from a mask ---------- */
function splitWords(el) {
  let n = 0;
  const walk = node => [...node.childNodes].forEach(c => {
    if (c.nodeType === 3) {
      const frag = document.createDocumentFragment();
      c.textContent.split(/(\s+)/).forEach(tok => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
        const m = document.createElement('span'); m.className = 'mw';
        const w = document.createElement('span'); w.style.setProperty('--i', n++); w.textContent = tok;
        m.appendChild(w); frag.appendChild(m);
      });
      c.replaceWith(frag);
    } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
  });
  walk(el);
}
$$('[data-split]').forEach(splitWords);

/* ---------- Odometer counters: every digit is a reel that spins to its value ---------- */
function initOdo(el) {
  const end = String(Math.round(+el.dataset.count)), pad = +el.dataset.pad || end.length;
  const str = end.padStart(pad, '0');
  el.classList.add('odo');
  // The reels are decoration; screen readers get the plain number.
  el.innerHTML = `<span class="sr-only">${end}</span>` + [...str].map((_, k) => `<span class="d" aria-hidden="true"><i style="--k:${k}">${'0123456789'.repeat(2).replace(/\d/g, m => `<b>${m}</b>`)}</i></span>`).join('');
  el._digits = [...str].map(Number);
}
function rollOdo(el, digits = el._digits, spins = true) {
  $$('i', el).forEach((i, k) => { i.style.transform = `translateY(${(-((spins ? 10 : 0) + digits[k]) * 1.2).toFixed(2)}em)`; });
}
$$('[data-count]').forEach(initOdo);
const odoIO = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; rollOdo(e.target); odoIO.unobserve(e.target);
}), { threshold: 0.6 });
$$('[data-count]:not([data-manual])').forEach(el => odoIO.observe(el));

/* ---------- Expertise accordion ---------- */
const accRows = $$('.acc__row');
accRows.forEach(r => $$('li', r).forEach((li, j) => li.style.setProperty('--j', j)));
function openRow(r) {
  accRows.forEach(x => { const on = x === r; x.classList.toggle('is-open', on); $('.acc__head', x).setAttribute('aria-expanded', String(on)); });
}
accRows.forEach(r => {
  const head = $('.acc__head', r);
  head.addEventListener('click', () => {
    if (r.classList.contains('is-open')) { r.classList.remove('is-open'); head.setAttribute('aria-expanded', 'false'); } else openRow(r);
  });
  if (matchMedia('(hover:hover)').matches) r.addEventListener('pointerenter', () => openRow(r));
});
if (accRows[0]) openRow(accRows[0]);

/* ---------- Dropdown menu ---------- */
const menuBtn = $('#menuBtn'), menu = $('#menu'), menuCur = $('#menuCur');
const menuLinks = $$('a[data-menu]', menu);
let menuOpen = false, menuHideT = 0;
function setMenu(open, { focus = true } = {}) {
  if (open === menuOpen) return;
  menuOpen = open;
  clearTimeout(menuHideT);
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    menu.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('open')));   // let the browser paint the closed state first
    if (focus) setTimeout(() => (menuLinks.find(a => a.classList.contains('on')) || menuLinks[0]).focus({ preventScroll: true }), 120);
  } else {
    menu.classList.remove('open');
    menuHideT = setTimeout(() => { if (!menuOpen) menu.hidden = true; }, 650);
    if (focus) menuBtn.focus({ preventScroll: true });
  }
}
menuBtn.addEventListener('click', () => setMenu(!menuOpen));
menuLinks.forEach(a => a.addEventListener('click', () => setMenu(false, { focus: false })));
$('[data-menu-cta]', menu).addEventListener('click', () => setMenu(false, { focus: false }));
addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) setMenu(false); });
document.addEventListener('pointerdown', e => { if (menuOpen && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false, { focus: false }); });
// hover effect: one highlight bar glides to whichever row is hovered or focused
const menuList = $('#menuList');
const hl = document.createElement('span'); hl.className = 'menu__hl'; hl.setAttribute('aria-hidden', 'true'); menuList.prepend(hl);
function hoverRow(a) {
  menuLinks.forEach(x => x.classList.toggle('hv', x === a));
  menuList.classList.toggle('hovering', !!a);
  hl.classList.toggle('show', !!a);
  if (a) { const li = a.parentElement; hl.style.height = li.offsetHeight + 'px'; hl.style.transform = `translateY(${li.offsetTop}px)`; }
}
menuLinks.forEach(a => {
  a.addEventListener('pointerenter', () => hoverRow(a));
  a.addEventListener('focus', () => hoverRow(a));
});
menuList.addEventListener('pointerleave', () => hoverRow(null));
menuList.addEventListener('focusout', e => { if (!menuList.contains(e.relatedTarget)) hoverRow(null); });
menuBtn.addEventListener('click', () => hoverRow(null));

// highlight the section you are in, and show its name at the bottom of the menu
const menuSections = menuLinks.map(a => ({ a, el: document.getElementById(a.dataset.menu) })).filter(x => x.el);
function markCurrent() {
  const y = innerHeight * 0.45; let best = menuSections[0];
  for (const x of menuSections) if (x.el.getBoundingClientRect().top <= y) best = x;
  menuLinks.forEach(a => a.classList.toggle('on', a === best.a));
  menuCur.textContent = best.a.querySelector('.ml').textContent;
}
addEventListener('scroll', markCurrent, { passive: true }); markCurrent();

/* ---------- HUD readout ---------- */
const hud = $('#hud');
let hudFrames = 0, hudLast = performance.now();
function hudTick() {
  hudFrames++;
  const now = performance.now();
  if (now - hudLast > 400) {
    const fps = Math.round(hudFrames * 1000 / (now - hudLast)); hudFrames = 0; hudLast = now;
    const max = document.documentElement.scrollHeight - innerHeight;
    hud.innerHTML = `<span><i></i>SYS ONLINE</span><span>FPS <b>${fps}</b></span><span class="hide-sm">X <b>${state.mouse.x.toFixed(2)}</b> Y <b>${state.mouse.y.toFixed(2)}</b></span><span>SCROLL <b>${String(Math.round(max > 0 ? scrollY / max * 100 : 0)).padStart(2, '0')}%</b></span>`;
  }
  requestAnimationFrame(hudTick);
}
hudTick();

/* ---------- Scroll progress: a hairline across the top ---------- */
const progress = document.createElement('div'); progress.className = 'progress'; progress.setAttribute('aria-hidden', 'true');
document.body.append(progress);

/* ---------- Marquee: two rows running opposite ways; scrolling pushes them along and leans them ---------- */
const marquee = $('.marquee');
const mqRows = [];
if (marquee) {
  const first = $('.marquee__track', marquee), second = first.cloneNode(true);
  second.classList.add('marquee__track--b'); marquee.append(second);
  [first, second].forEach((el, i) => mqRows.push({ el, x: 0, dir: i ? 1 : -1, half: 0 }));
  marquee.classList.add('is-live');
}
let mqSkew = 0;
function marqueeTick(dt, vel) {
  if (!mqRows.length || reduced) return;
  const push = clamp(vel * 0.9, -2600, 2600);                       // scroll speed carries the rows along
  mqSkew = lerp(mqSkew, clamp(vel * 0.012, -7, 7), 1 - Math.pow(0.01, dt));
  for (const r of mqRows) {
    if (!r.half) r.half = r.el.scrollWidth / 2;
    r.x += r.dir * (70 + Math.abs(push)) * dt * (push < 0 ? -1 : 1);
    r.x = ((r.x % r.half) - r.half) % r.half;                       // the track holds the words twice, so wrap at half
    r.el.style.transform = `translate3d(${r.x.toFixed(1)}px,0,0) skewX(${(-mqSkew * r.dir).toFixed(2)}deg)`;
  }
}
addEventListener('resize', () => mqRows.forEach(r => { r.half = 0; }));

/* ---------- Spotlight: panels are lit from wherever the pointer is; toolkit cards also lean towards it ---------- */
const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
$$('.tk,.term,.cform').forEach(el => {
  el.classList.add('glow');
  if (!fine) return;
  const tilt = el.classList.contains('tk') && !reduced;
  el.addEventListener('pointerenter', () => { el.style.transitionDelay = '0s'; }, { once: true });   // drop the reveal's stagger, or the lean would lag
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    if (tilt) { el.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * 11).toFixed(2) + 'deg'); }
  });
  el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
});

/* ---------- Magnetic buttons: they lean towards the pointer and spring back ---------- */
if (fine && !reduced) $$('.pill,.menu-btn,.cform__send').forEach(el => {
  el.classList.add('magnet');
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tx', ((e.clientX - r.left - r.width / 2) * 0.28).toFixed(1) + 'px');
    el.style.setProperty('--ty', ((e.clientY - r.top - r.height / 2) * 0.4).toFixed(1) + 'px');
  });
  el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); });
});

/* ---------- Experience: the timeline fills as you read down it ---------- */
const xpLine = $('#xpLine'), xpItems = $$('.xp__item');
function timelineTick() {
  if (!xpLine) return;
  const r = xpLine.getBoundingClientRect(), mark = innerHeight * 0.62;
  xpLine.style.setProperty('--p', clamp((mark - r.top) / r.height, 0, 1).toFixed(4));
  xpItems.forEach(it => it.classList.toggle('passed', it.getBoundingClientRect().top + 12 < mark));
}

/* ---------- Section labels decode into place ---------- */
const GLYPHS = '01<>/\\[]{}=+*#_';
function decode(el) {
  if (reduced || CJK || el.dataset.decoded) return;
  el.dataset.decoded = '1';
  const text = el.textContent, t0 = performance.now(), dur = 520 + text.length * 16;
  el.setAttribute('aria-label', text);
  (function step(now) {
    const k = clamp((now - t0) / dur, 0, 1), n = Math.floor(k * text.length);
    el.textContent = text.slice(0, n) + [...text.slice(n)].map(c => (c === ' ' ? ' ' : GLYPHS[Math.random() * GLYPHS.length | 0])).join('');
    if (k < 1) requestAnimationFrame(step); else { el.textContent = text; el.removeAttribute('aria-label'); }
  })(t0);
}

/* ---------- One tick for the page-level effects ---------- */
let fxLast = performance.now(), fxScroll = scrollY, fxVel = 0;
(function fxTick(now) {
  const dt = Math.min((now - fxLast) / 1000, 0.05) || 0.016; fxLast = now;
  const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
  fxVel = lerp(fxVel, (y - fxScroll) / dt, 1 - Math.pow(0.002, dt)); fxScroll = y;
  progress.style.transform = `scaleX(${(max > 0 ? y / max : 0).toFixed(4)})`;
  marqueeTick(dt, fxVel);
  timelineTick();
  requestAnimationFrame(fxTick);
})(fxLast);

/* ---------- Language switch: keep the reader's place ---------- */
$$('.lang a').forEach(a => a.addEventListener('click', () => {
  if (location.hash) a.href = a.getAttribute('href').split('#')[0] + location.hash;
}));

/* ---------- Loader ---------- */
const loader = $('#loader'), num = $('#loaderNum'), ring = $('#loaderRing'), statusEl = $('#loaderStatus');
const RING_LEN = 2 * Math.PI * 54;
const STATUS = [0, 30, 65, 100].map((at, i) => [at, T.status[i]]);
let prog = 0;
const fontsReady = (document.fonts?.ready ?? Promise.resolve()).catch(() => {});
let fontsDone = false; fontsReady.then(() => fontsDone = true);
setTimeout(() => fontsDone = true, 2200); // never let a slow font block the site
const t0 = performance.now();
let lastT = t0;
const seen = document.documentElement.classList.contains('seen');
if (seen) finish();
else (function load(now) {
  const elapsed = Math.max(0, now - t0);                   // the first frame's timestamp can be slightly before t0
  const dt = clamp(now - lastT, 0, 100); lastT = now;
  const targetP = fontsDone ? 100 : Math.min(90, elapsed / 18);
  prog = lerp(prog, targetP, 1 - Math.pow(0.92, dt / (1000 / 60))); // same speed at any frame rate
  const p = clamp(Math.round(prog + (fontsDone ? 1 : 0)), 0, 100);
  num.textContent = String(p).padStart(3, '0');
  ring.style.strokeDashoffset = (RING_LEN * (1 - p / 100)).toFixed(1);
  statusEl.textContent = STATUS.filter(x => p >= x[0]).pop()[1];
  if (p >= 100 && elapsed > 900) return finish();
  requestAnimationFrame(load);
})(t0);
function finish() {
  try { sessionStorage.setItem('orbit:intro', '1'); } catch (e) {} // storage can be blocked; the intro then just plays again
  introGo = true;
  loader.classList.add('done');
  document.body.classList.add('ready');
  document.documentElement.classList.add('ready');
}
frame();
