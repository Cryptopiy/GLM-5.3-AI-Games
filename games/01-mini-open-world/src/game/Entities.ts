import * as THREE from 'three';

export interface CharacterParts {
  group: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
}

const charMats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number): THREE.MeshStandardMaterial {
  let m = charMats.get(String(color));
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    charMats.set(String(color), m);
  }
  return m;
}

/** Simple low-poly pedestrian/player character facing +Z. */
export function makeCharacter(opts: {
  shirt: number;
  pants: number;
  skin: number;
  hat?: number;
}): CharacterParts {
  const g = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.5, 4, 10),
    mat(opts.shirt),
  );
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 12, 10),
    mat(opts.skin),
  );
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);

  if (opts.hat !== undefined) {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.12, 10),
      mat(opts.hat),
    );
    hat.position.y = 1.76;
    g.add(hat);
  }

  const legGeo = new THREE.CapsuleGeometry(0.1, 0.45, 3, 8);
  legGeo.translate(0, -0.3, 0);
  const legL = new THREE.Mesh(legGeo, mat(opts.pants));
  legL.position.set(-0.14, 0.62, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, mat(opts.pants));
  legR.position.set(0.14, 0.62, 0);
  legR.castShadow = true;
  g.add(legL, legR);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.4, 3, 8);
  armGeo.translate(0, -0.27, 0);
  const armL = new THREE.Mesh(armGeo, mat(opts.shirt));
  armL.position.set(-0.36, 1.32, 0);
  const armR = new THREE.Mesh(armGeo, mat(opts.shirt));
  armR.position.set(0.36, 1.32, 0);
  g.add(armL, armR);

  return { group: g, legL, legR, armL, armR };
}

export interface CarParts {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  frontPivots: THREE.Group[];
  lightMatA?: THREE.MeshStandardMaterial;
  lightMatB?: THREE.MeshStandardMaterial;
}

/** Low-poly car facing +Z. Chassis + cabin + wheels + lights. */
export function makeCar(kind: 'civil' | 'police' | 'mission', color: number): CarParts {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.25,
  });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.52, 4.3), bodyMat);
  chassis.position.y = 0.62;
  chassis.castShadow = true;
  g.add(chassis);

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.3, 3.9),
    new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.9 }),
  );
  skirt.position.y = 0.3;
  g.add(skirt);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.66, 0.52, 2.0),
    new THREE.MeshStandardMaterial({
      color: 0x20262e,
      roughness: 0.2,
      metalness: 0.4,
    }),
  );
  cabin.position.set(0, 1.12, -0.25);
  cabin.castShadow = true;
  g.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Group[] = [];
  for (const [wx, wz, front] of [
    [-0.88, 1.35, 1],
    [0.88, 1.35, 1],
    [-0.88, -1.35, 0],
    [0.88, -1.35, 0],
  ] as const) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.castShadow = true;
    if (front) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.36, wz);
      w.position.set(0, 0, 0);
      pivot.add(w);
      g.add(pivot);
      frontPivots.push(pivot);
    } else {
      w.position.set(wx, 0.36, wz);
      g.add(w);
    }
    wheels.push(w);
  }

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c0,
    emissive: 0xfff2c0,
    emissiveIntensity: 0.9,
  });
  for (const hx of [-0.6, 0.6]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), headMat);
    light.position.set(hx, 0.66, 2.16);
    g.add(light);
  }
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff4040,
    emissive: 0xff2020,
    emissiveIntensity: 0.7,
  });
  for (const hx of [-0.6, 0.6]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tailMat);
    light.position.set(hx, 0.66, -2.16);
    g.add(light);
  }

  let lightMatA: THREE.MeshStandardMaterial | undefined;
  let lightMatB: THREE.MeshStandardMaterial | undefined;

  if (kind === 'police') {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.94, 0.2, 4.32),
      new THREE.MeshStandardMaterial({ color: 0x0d0f13, roughness: 0.6 }),
    );
    stripe.position.y = 0.5;
    g.add(stripe);

    const barBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.1, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    barBase.position.set(0, 1.44, -0.2);
    g.add(barBase);
    lightMatA = new THREE.MeshStandardMaterial({
      color: 0xff3030,
      emissive: 0xff0000,
      emissiveIntensity: 2,
    });
    lightMatB = new THREE.MeshStandardMaterial({
      color: 0x3050ff,
      emissive: 0x2040ff,
      emissiveIntensity: 0.2,
    });
    const lampA = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), lightMatA);
    lampA.position.set(-0.26, 1.55, -0.2);
    const lampB = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), lightMatB);
    lampB.position.set(0.26, 1.55, -0.2);
    g.add(lampA, lampB);
  }

  if (kind === 'mission') {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 0.16, 4.34),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 }),
    );
    stripe.position.y = 0.86;
    g.add(stripe);
  }

  return { group: g, wheels, frontPivots, lightMatA, lightMatB };
}
