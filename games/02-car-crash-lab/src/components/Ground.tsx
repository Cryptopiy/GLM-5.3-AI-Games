import { useMemo } from 'react';
import * as THREE from 'three';
import { COLORS } from '../config/constants';

/** Generate a distance-marker label texture (no external assets). */
function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#10141b';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#f5b31b';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);
  ctx.fillStyle = '#f2f5f9';
  ctx.font = 'bold 72px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/** Yellow/black chevron texture for the impact zone. */
function chevronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#f5b31b';
  ctx.lineWidth = 34;
  for (let i = -2; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64 - 32, 256);
    ctx.lineTo(i * 64 + 96, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1.4);
  tex.anisotropy = 4;
  return tex;
}

const TRACK_LEN = 260;
const TRACK_W = 26;

export function Ground(): JSX.Element {
  const chevron = useMemo(() => chevronTexture(), []);
  const markers = useMemo(() => {
    const list: Array<{ z: number; tex: THREE.CanvasTexture }> = [];
    for (let d = 10; d <= 90; d += 10) {
      list.push({ z: -d, tex: labelTexture(`${d} m`) });
    }
    return list;
  }, []);

  const dashes = useMemo(() => {
    const list: number[] = [];
    for (let z = -TRACK_LEN / 2 + 4; z < -7; z += 6) list.push(z);
    return list;
  }, []);

  return (
    <group>
      {/* Surrounding terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={COLORS.ground} roughness={1} />
      </mesh>

      {/* Asphalt test track */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -TRACK_LEN / 2 + 30]} receiveShadow>
        <planeGeometry args={[TRACK_W, TRACK_LEN]} />
        <meshStandardMaterial color={COLORS.asphaltTrack} roughness={0.95} />
      </mesh>

      {/* Side lines */}
      {[-TRACK_W / 2 + 0.35, TRACK_W / 2 - 0.35].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.005, -TRACK_LEN / 2 + 30]}>
          <planeGeometry args={[0.18, TRACK_LEN - 2]} />
          <meshStandardMaterial color={COLORS.line} roughness={0.7} />
        </mesh>
      ))}

      {/* Centre dashes */}
      {dashes.map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, z]}>
          <planeGeometry args={[0.16, 1.6]} />
          <meshStandardMaterial color={COLORS.line} roughness={0.7} transparent opacity={0.85} />
        </mesh>
      ))}

      {/* Impact zone chevrons right in front of the obstacle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -3.4]}>
        <planeGeometry args={[TRACK_W - 1, 6]} />
        <meshStandardMaterial map={chevron} roughness={0.8} />
      </mesh>

      {/* Distance markers with labels on both sides */}
      {markers.map((m) =>
        [-1, 1].map((side) => (
          <group key={`${m.z}-${side}`} position={[side * (TRACK_W / 2 + 1.6), 0, m.z]}>
            <mesh position={[0, 0.55, 0]} castShadow>
              <boxGeometry args={[0.1, 1.1, 0.1]} />
              <meshStandardMaterial color={0xe8ecf2} roughness={0.6} />
            </mesh>
            <mesh position={[0, 1.35, 0]}>
              <planeGeometry args={[1.15, 0.58]} />
              <meshStandardMaterial map={m.tex} side={THREE.DoubleSide} roughness={0.7} />
            </mesh>
          </group>
        ))
      )}

      {/* Rear gate marking the start of the runway */}
      <mesh position={[0, 1.4, -TRACK_LEN / 2 + 34]} castShadow>
        <boxGeometry args={[TRACK_W, 0.22, 0.22]} />
        <meshStandardMaterial color={0xf2f5f9} roughness={0.6} />
      </mesh>
      {[-TRACK_W / 2, TRACK_W / 2].map((x) => (
        <mesh key={x} position={[x, 0.7, -TRACK_LEN / 2 + 34]} castShadow>
          <boxGeometry args={[0.16, 1.4, 0.16]} />
          <meshStandardMaterial color={0x9aa0a8} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}
