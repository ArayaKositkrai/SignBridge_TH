import { FilesetResolver, HandLandmarker, HolisticLandmarker } from "@mediapipe/tasks-vision";
import { HAND_MODEL_URL, HOLISTIC_MODEL_URL, MEDIAPIPE_WASM_URL } from "../../config/env";
import type { LandmarkFrame, Point } from "../../types";

// โมเดลที่ใช้ตรวจจับ: Holistic (ตัว มือ หน้า) + HandLandmarker (หามือทั้งภาพ ใช้เสริมตอน Holistic หามือไม่เจอ)
export interface Landmarkers {
  holistic: HolisticLandmarker;
  hands: HandLandmarker | null;
}

// เก็บโมเดลที่โหลดแล้ว จะได้โหลดแค่ครั้งเดียว
let landmarkerPromise: Promise<Landmarkers> | null = null;

// สร้างโมเดลโดยลองใช้ GPU ก่อน ถ้าไม่ได้ใช้ CPU
async function withDelegate<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await make("GPU");
  } catch {
    return await make("CPU");
  }
}

// โหลดโมเดลทั้งสองตัว (โหลด HandLandmarker ไม่ได้ก็ยังใช้ Holistic อย่างเดียวได้)
export function loadHolistic(): Promise<Landmarkers> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      const [holistic, hands] = await Promise.all([
        withDelegate((delegate) =>
          HolisticLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HOLISTIC_MODEL_URL, delegate },
            runningMode: "VIDEO",
            minPoseDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
          }),
        ),
        withDelegate((delegate) =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        ).catch(() => null),
      ]);
      return { holistic, hands };
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

// แปลงผลของ MediaPipe เป็นรายการจุด x,y,z (คนแรกที่ตรวจเจอ)
const toPoints = (list?: Point[][]): Point[] =>
  list?.[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? [];

// เวลาล่าสุดที่ส่งให้แต่ละโมเดล (MediaPipe ต้องการเวลาที่เพิ่มขึ้นเรื่อย ๆ ห้ามซ้ำ)
let lastTimestamp = 0;
let lastHandTimestamp = 0;

// จุดข้อมือใน pose ของ MediaPipe (ข้างของคนทำท่า) และไหล่ไว้วัดระยะ
const POSE_L_WRIST = 15;
const POSE_R_WRIST = 16;
const POSE_L_SHOULDER = 11;
const POSE_R_SHOULDER = 12;
// มือที่หาเจอต้องอยู่ใกล้ข้อมือของ pose ไม่เกินกี่เท่าของความกว้างไหล่ จึงนับเป็นมือข้างนั้น
const WRIST_MATCH = 0.6;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// เติมมือที่ Holistic หาไม่เจอ ด้วยมือจาก HandLandmarker (หาทั้งภาพ ไม่ต้องพึ่งตำแหน่งแขน)
//   จับคู่มือกับข้อมือของ pose ที่ใกล้ที่สุด (ซ้าย/ขวาตรงกับที่ Holistic ใช้) และไม่ซ้ำกับมือที่ Holistic เจอแล้ว
//   ไม่เห็นตัวคน (ไม่มี pose) ไม่เติม เพราะบอกไม่ได้ว่าเป็นมือข้างไหน
function fillMissingHands(frame: LandmarkFrame, found: Point[][]): void {
  const { pose } = frame;
  if (pose.length <= POSE_R_WRIST || !found.length) return;
  const limit = Math.max(dist(pose[POSE_L_SHOULDER], pose[POSE_R_SHOULDER]) * WRIST_MATCH, 0.05);
  const taken = [frame.leftHand[0], frame.rightHand[0]].filter(Boolean);
  const sides = [
    { key: "leftHand" as const, wrist: pose[POSE_L_WRIST] },
    { key: "rightHand" as const, wrist: pose[POSE_R_WRIST] },
  ];
  for (const side of sides) {
    if (frame[side.key].length) continue;
    let best: Point[] | null = null;
    let bestDist = limit;
    for (const hand of found) {
      if (hand.length !== 21 || taken.some((w) => dist(w, hand[0]) < limit / 2)) continue;
      const d = dist(hand[0], side.wrist);
      if (d < bestDist) [best, bestDist] = [hand, d];
    }
    if (best) {
      frame[side.key] = best;
      taken.push(best[0]);
    }
  }
}

// ตรวจจับท่าทางจากเฟรมวิดีโอหนึ่งเฟรม (เรียก HandLandmarker เฉพาะตอนมือหายไปข้างใดข้างหนึ่ง)
export function detect(models: Landmarkers, video: HTMLVideoElement, timestampMs: number): LandmarkFrame {
  lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
  const r = models.holistic.detectForVideo(video, lastTimestamp);
  const frame: LandmarkFrame = {
    pose: toPoints(r.poseLandmarks),
    leftHand: toPoints(r.leftHandLandmarks),
    rightHand: toPoints(r.rightHandLandmarks),
    face: toPoints(r.faceLandmarks),
  };
  if (models.hands && frame.pose.length && (!frame.leftHand.length || !frame.rightHand.length)) {
    lastHandTimestamp = Math.max(timestampMs, lastHandTimestamp + 1);
    const h = models.hands.detectForVideo(video, lastHandTimestamp);
    fillMissingHands(frame, h.landmarks.map((hand) => hand.map((p) => ({ x: p.x, y: p.y, z: p.z }))));
  }
  return frame;
}

// เส้นเชื่อมจุดของลำตัว มือ และใบหน้า (มาจาก MediaPipe)
export const POSE_CONNECTIONS = HolisticLandmarker.POSE_CONNECTIONS;
export const HAND_CONNECTIONS = HolisticLandmarker.HAND_CONNECTIONS;
export const FACE_CONTOURS = HolisticLandmarker.FACE_LANDMARKS_CONTOURS;
