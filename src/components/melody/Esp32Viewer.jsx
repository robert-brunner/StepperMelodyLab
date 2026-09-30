// Esp32Viewer.jsx — ESP32 WROOM-32 DevKit (30-pin)
// Model from STEP: 15 pins/side, 2.54mm pitch, real mm coords
// LEFT  (X=-0.635): bottom→top = VIN GND D13 D12 D14 D27 D26 D25 D33 D32 D35 D34 VN VP EN
// RIGHT (X=24.765): bottom→top = 3V3 GND D15 D2  D4  RX2 TX2 D5  D18 D19 D21 RX0 TX0 D22 D23
//
// Labels are real 3D text lying flat on the board plane (like silkscreen).
// They're geometry anchored at the wire tip, so they can't drift when rotating,
// and label height < 2.54mm pin pitch, so they can't overlap from any angle.

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import modelUrl from "./esp32-final-model.glb";

const LEFT_X  = -0.635;
const RIGHT_X =  24.765;
const PIN_TOP = 1.375;          // measured top of header pins
const MARKER_Z = PIN_TOP + 0.08;
const WIRE_Z   = PIN_TOP + 0.12;
const LABEL_Z  = PIN_TOP + 0.12;

const PIN_YS = [7.27,9.81,12.35,14.89,17.43,19.97,22.51,25.05,27.59,30.13,32.67,35.21,37.75,40.29,42.83];

const GPIO_POS = {
  13: [LEFT_X,  PIN_YS[2]],
  12: [LEFT_X,  PIN_YS[3]],
  14: [LEFT_X,  PIN_YS[4]],
  27: [LEFT_X,  PIN_YS[5]],
  26: [LEFT_X,  PIN_YS[6]],
  25: [LEFT_X,  PIN_YS[7]],
  33: [LEFT_X,  PIN_YS[8]],
  32: [LEFT_X,  PIN_YS[9]],
  35: [LEFT_X,  PIN_YS[10]],
  34: [LEFT_X,  PIN_YS[11]],
  39: [LEFT_X,  PIN_YS[12]],
  36: [LEFT_X,  PIN_YS[13]],
  15: [RIGHT_X, PIN_YS[2]],
   2: [RIGHT_X, PIN_YS[3]],
   4: [RIGHT_X, PIN_YS[4]],
  16: [RIGHT_X, PIN_YS[5]],
  17: [RIGHT_X, PIN_YS[6]],
   5: [RIGHT_X, PIN_YS[7]],
  18: [RIGHT_X, PIN_YS[8]],
  19: [RIGHT_X, PIN_YS[9]],
  21: [RIGHT_X, PIN_YS[10]],
   3: [RIGHT_X, PIN_YS[11]],
   1: [RIGHT_X, PIN_YS[12]],
  22: [RIGHT_X, PIN_YS[13]],
  23: [RIGHT_X, PIN_YS[14]],
};

const SPECIAL_POS = {
  "VIN":   [LEFT_X,  PIN_YS[0]],
  "GND_L": [LEFT_X,  PIN_YS[1]],
  "EN":    [LEFT_X,  PIN_YS[14]],
  "3V3":   [RIGHT_X, PIN_YS[0]],
  "GND_R": [RIGHT_X, PIN_YS[1]],
};

const resolveXY = (def) =>
  def.gpio    !== undefined ? GPIO_POS[def.gpio]       ?? null :
  def.special !== undefined ? SPECIAL_POS[def.special] ?? null : null;

const WIRE_DEFS = [
  { id: "vin",      special: "VIN",   color: "#ff2222", label: "VIN  ←  LM2596 5V" },
  { id: "3v3",      special: "3V3",   color: "#ff6666", label: "3V3  →  A4988 VDD / RST / SLP / OLED / ENC+" },
  { id: "gnd_l",    special: "GND_L", color: "#aaaaaa", label: "GND" },
  { id: "gnd_r",    special: "GND_R", color: "#aaaaaa", label: "GND" },
  { id: "m1step",   motor: 1, gpio: 16, color: "#00ff00", label: "M1 STEP  →  A4988 #1  (RX2)" },
  { id: "m1dir",    motor: 1, gpio: 17, color: "#aaff00", label: "M1 DIR   →  A4988 #1  (TX2)" },
  { id: "m2step",   motor: 2, gpio: 19, color: "#00bfff", label: "M2 STEP  →  A4988 #2  (D19)" },
  { id: "m2dir",    motor: 2, gpio: 18, color: "#7fdfff", label: "M2 DIR   →  A4988 #2  (D18)" },
  { id: "m3step",   motor: 3, gpio: 26, color: "#ff8c00", label: "M3 STEP  →  A4988 #3  (D26)" },
  { id: "m3dir",    motor: 3, gpio: 27, color: "#ffcc44", label: "M3 DIR   →  A4988 #3  (D27)" },
  { id: "oled_sda", gpio: 21, color: "#cc66ff", label: "OLED SDA  (D21)" },
  { id: "oled_scl", gpio: 22, color: "#aa44ee", label: "OLED SCL  (D22)" },
  { id: "enc_sw",   gpio:  4, color: "#ff69b4", label: "ENC SW  (D4)" },
  { id: "enc_dt",   gpio:  5, color: "#ff9fcc", label: "ENC DT  (D5)" },
  { id: "enc_clk",  gpio: 23, color: "#ffb6d9", label: "ENC CLK  (D23)" },
];

// ── Board ─────────────────────────────────────────────────────────────────────
const BOARD_COLOR = "#e8702a";

function BoardModel() {
  const { scene } = useGLTF(modelUrl);
  useEffect(() => {
    scene.traverse((child) => {
      if (child.isMesh) {
        child.geometry = child.geometry.toNonIndexed();
        child.geometry.computeVertexNormals();
        child.material = new THREE.MeshStandardMaterial({
          color: BOARD_COLOR, roughness: 0.8, metalness: 0.0,
        });
      }
    });
  }, [scene]);
  return <primitive object={scene} />;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight position={[40, 80, 40]}  intensity={2.8} />
      <directionalLight position={[-30, 30, 20]} intensity={0.8} />
      <directionalLight position={[12, -20, -30]} intensity={0.4} />
    </>
  );
}

// ── Flat 3D label with background box + border ───────────────────────────────
const FONT = 1.2;  // mm — box ends up ~2.1mm tall, under the 2.54mm pitch
const PAD  = 0.35;

function FlatLabel({ x, y, onLeft, color, text }) {
  const [box, setBox] = useState(null);
  const textX = onLeft ? -PAD : PAD;  // outer box edge lands exactly on the wire tip

  const handleSync = (mesh) => {
    const b = mesh.textRenderInfo?.blockBounds;
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    const next = {
      cx: textX + (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      w:  (x1 - x0) + PAD * 2,
      h:  (y1 - y0) + PAD * 2,
    };
    setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
  };

  return (
    <group position={[x, y, LABEL_Z]}>
      {box && (
        <>
          <mesh position={[box.cx, box.cy, 0]}>
            <planeGeometry args={[box.w, box.h]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.82} />
          </mesh>
          <Line
            points={[
              [box.cx - box.w / 2, box.cy - box.h / 2, 0.02],
              [box.cx + box.w / 2, box.cy - box.h / 2, 0.02],
              [box.cx + box.w / 2, box.cy + box.h / 2, 0.02],
              [box.cx - box.w / 2, box.cy + box.h / 2, 0.02],
              [box.cx - box.w / 2, box.cy - box.h / 2, 0.02],
            ]}
            color={color}
            lineWidth={1}
          />
        </>
      )}
      <Text
        position={[textX, 0, 0.04]}
        fontSize={FONT}
        color={color}
        anchorX={onLeft ? "right" : "left"}
        anchorY="middle"
        onSync={handleSync}
      >
        {text}
      </Text>
    </group>
  );
}

// ── Wire + marker + label ─────────────────────────────────────────────────────
function WireLabel({ xy, color, label }) {
  const [px, py] = xy;
  const onLeft  = px < 12;
  const outDir  = onLeft ? -1 : 1;
  const wireLen = 4.0;
  const endX    = px + outDir * wireLen;

  return (
    <group>
      {/* Marker sits flat on the pin top (group already maps local XY → board plane) */}
      <mesh position={[px, py, MARKER_Z]}>
        <ringGeometry args={[0.45, 0.75, 24]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[px, py, MARKER_Z + 0.01]}>
        <circleGeometry args={[0.25, 16]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <Line
        points={[
          [px + outDir * 0.75, py, WIRE_Z],
          [endX,               py, WIRE_Z],
        ]}
        color={color}
        lineWidth={1.8}
        dashed
        dashSize={0.9}
        gapSize={0.45}
      />
      <FlatLabel x={endX} y={py} onLeft={onLeft} color={color} text={label} />
    </group>
  );
}

// ── Main viewer ───────────────────────────────────────────────────────────────
const Esp32Viewer = ({ motorCount = 3 }) => (
  <div style={{ width:"100%",height:"100%",position:"absolute",top:0,left:0,background:"#1a1a2e" }}>
    <Canvas
      style={{ width:"100%",height:"100%",display:"block" }}
      camera={{ position:[12, 70, 28], fov: 42 }}
    >
      <Lights />

      <group rotation={[-Math.PI/2, 0, 0]}>
        <BoardModel />
        {WIRE_DEFS.filter((def) => !def.motor || def.motor <= motorCount).map((def) => {
          const xy = resolveXY(def);
          if (!xy) return null;
          return <WireLabel key={def.id} xy={xy} color={def.color} label={def.label} />;
        })}
      </group>

      <OrbitControls
        target={[12, 0, -25]}
        enablePan
        mouseButtons={{ LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.PAN, RIGHT:THREE.MOUSE.PAN }}
        enableDamping
        dampingFactor={0.05}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
      />
    </Canvas>

    <div style={{ position:"absolute",bottom:10,left:12,color:"#666",fontSize:"11px",pointerEvents:"none",lineHeight:1.7 }}>
      <div>Left-drag · Rotate</div>
      <div>Middle-drag · Pan</div>
      <div>Scroll · Zoom</div>
    </div>
  </div>
);

export default Esp32Viewer;