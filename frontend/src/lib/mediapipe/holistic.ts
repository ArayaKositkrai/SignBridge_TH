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
            // มือที่ความมั่นใจต่ำ (มักเป็นมือที่ห้อยอยู่ขอบภาพ) ไม่นับ
            minHandLandmarksConfidence: 0.6,
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
//   withVisibility = เก็บ visibility ด้วย (ใช้กับ pose เท่านั้น เพราะมือ/ใบหน้าของ MediaPipe ให้ visibility เป็น 0 เสมอ)
const toPoints = (list?: Point[][], withVisibility = false): Point[] =>
  list?.[0]?.map((p) =>
    withVisibility && p.visibility !== undefined
      ? { x: p.x, y: p.y, z: p.z, visibility: p.visibility }
      : { x: p.x, y: p.y, z: p.z },
  ) ?? [];

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
// ข้อมือใน pose ที่ความชัดต่ำกว่านี้ ถือว่ามือข้างนั้นไม่อยู่ในภาพ (ตัดมือของข้างนั้นทิ้ง กันมือผี)
const WRIST_MIN_VISIBILITY = 0.3;
// ข้อมือที่ความชัดต่ำกว่านี้ จะไม่ถูกใช้เติมมือจาก HandLandmarker
const FILL_MIN_VISIBILITY = 0.5;
// กรอบมือสองกรอบที่ซ้อนกันเกินสัดส่วนนี้ ถือว่าเป็นมือเดียวกัน
const SAME_HAND_IOU = 0.3;
// มือที่ HandLandmarker บอกข้างสวนกับข้างที่จับคู่ (ความมั่นใจสูง) ถูกนับว่าไกลขึ้นเท่านี้
const HANDEDNESS_PENALTY = 1.6;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// ความชัดของจุดใน pose (ไม่มีค่า = ถือว่าเห็น)
const visibilityOf = (p: Point | undefined) => p?.visibility ?? 1;

// กรอบล้อมรอบจุดของมือ
function box(hand: Point[]) {
  const xs = hand.map((p) => p.x);
  const ys = hand.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// สัดส่วนการซ้อนทับของกรอบมือสองมือ (0 = ไม่ซ้อน, 1 = ตรงกันพอดี)
function iou(a: Point[], b: Point[]): number {
  const p = box(a);
  const q = box(b);
  const w = Math.max(0, Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0));
  const h = Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0));
  const inter = w * h;
  const area = (r: typeof p) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return inter / (area(p) + area(q) - inter || 1);
}

// มือหนึ่งมือจาก HandLandmarker พร้อมข้างที่โมเดลเดา (ข้างของคนทำท่า) และความมั่นใจ
interface FoundHand {
  points: Point[];
  side: "leftHand" | "rightHand" | null;
  score: number;
}

// เติมมือที่ Holistic หาไม่เจอ ด้วยมือจาก HandLandmarker (หาทั้งภาพ ไม่ต้องพึ่งตำแหน่งแขน)
//   จับคู่มือกับข้อมือของ pose แบบทั้งสองข้างพร้อมกัน (เลือกคู่ที่ใกล้สุดก่อน มือหนึ่งไม่ถูกใช้ซ้ำสองข้าง)
//   ไม่เติมข้างที่ข้อมือใน pose มองไม่ชัด, ไม่ใช้มือที่ซ้อนกับมือที่ Holistic เจอแล้ว, ข้างที่โมเดลมือเดาสวนทางถูกลดลำดับ
//   ไม่เห็นตัวคน (ไม่มี pose) ไม่เติม เพราะบอกไม่ได้ว่าเป็นมือข้างไหน
function fillMissingHands(frame: LandmarkFrame, found: FoundHand[]): void {
  const { pose } = frame;
  if (pose.length <= POSE_R_WRIST || !found.length) return;
  const limit = Math.max(dist(pose[POSE_L_SHOULDER], pose[POSE_R_SHOULDER]) * WRIST_MATCH, 0.05);
  const taken = [frame.leftHand, frame.rightHand].filter((h) => h.length === 21);
  const sides = [
    { key: "leftHand" as const, wrist: pose[POSE_L_WRIST] },
    { key: "rightHand" as const, wrist: pose[POSE_R_WRIST] },
  ].filter((side) => !frame[side.key].length && visibilityOf(side.wrist) >= FILL_MIN_VISIBILITY);
  const hands = found.filter((h) => h.points.length === 21 && !taken.some((t) => iou(t, h.points) > SAME_HAND_IOU));

  // ทุกคู่ (มือ, ข้าง) ที่อยู่ในระยะ เรียงจากใกล้ไปไกล แล้วเลือกทีละคู่โดยไม่ซ้ำมือและไม่ซ้ำข้าง
  const pairs = sides
    .flatMap((side) =>
      hands.map((hand) => {
        const d = dist(hand.points[0], side.wrist);
        const against = hand.side !== null && hand.side !== side.key && hand.score > 0.8;
        return { side, hand, d, rank: against ? d * HANDEDNESS_PENALTY : d };
      }),
    )
    .filter((p) => p.d < limit)
    .sort((a, b) => a.rank - b.rank);
  const usedHands = new Set<FoundHand>();
  const usedSides = new Set<string>();
  for (const { side, hand } of pairs) {
    if (usedHands.has(hand) || usedSides.has(side.key)) continue;
    frame[side.key] = hand.points;
    usedHands.add(hand);
    usedSides.add(side.key);
  }
}

// ตัดมือของข้างที่ข้อมือใน pose มองไม่เห็น (มือที่ห้อยนอกภาพ/ถูกบัง แต่โมเดลยังเดาตำแหน่งมาให้)
function dropHiddenHands(frame: LandmarkFrame): void {
  if (frame.pose.length <= POSE_R_WRIST) return;
  if (visibilityOf(frame.pose[POSE_L_WRIST]) < WRIST_MIN_VISIBILITY) frame.leftHand = [];
  if (visibilityOf(frame.pose[POSE_R_WRIST]) < WRIST_MIN_VISIBILITY) frame.rightHand = [];
}

// ตรวจจับท่าทางจากเฟรมวิดีโอหนึ่งเฟรม (เรียก HandLandmarker เฉพาะตอนมือหายไปข้างใดข้างหนึ่ง)
export function detect(models: Landmarkers, video: HTMLVideoElement, timestampMs: number): LandmarkFrame {
  lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
  const r = models.holistic.detectForVideo(video, lastTimestamp);
  const frame: LandmarkFrame = {
    pose: toPoints(r.poseLandmarks, true),
    leftHand: toPoints(r.leftHandLandmarks),
    rightHand: toPoints(r.rightHandLandmarks),
    face: toPoints(r.faceLandmarks),
  };
  dropHiddenHands(frame);
  // รันโมเดลมือเพิ่มเฉพาะเมื่อข้างที่หายมีข้อมืออยู่ในภาพจริง (ท่ามือเดียวที่อีกมือห้อยนอกภาพไม่ต้องรัน
  //   ประหยัดเวลาประมวลผลเกือบครึ่งต่อเฟรมบนโน้ตบุ๊ก = ได้เฟรมต่อวินาทีมากขึ้น จับท่าที่ทำเร็วได้ดีขึ้น)
  const wantFill =
    frame.pose.length > POSE_R_WRIST &&
    ((!frame.leftHand.length && visibilityOf(frame.pose[POSE_L_WRIST]) >= FILL_MIN_VISIBILITY) ||
      (!frame.rightHand.length && visibilityOf(frame.pose[POSE_R_WRIST]) >= FILL_MIN_VISIBILITY));
  if (models.hands && wantFill) {
    lastHandTimestamp = Math.max(timestampMs, lastHandTimestamp + 1);
    const h = models.hands.detectForVideo(video, lastHandTimestamp);
    // ข้างที่โมเดลมือบอกคิดจากภาพแบบกระจก: วิดีโอที่ไม่กลับภาพ "Left" จึงเป็นมือขวาของคนทำท่า
    const found = h.landmarks.map((hand, i): FoundHand => {
      const cat = h.handedness[i]?.[0];
      const side = cat ? (cat.categoryName === "Left" ? "rightHand" : "leftHand") : null;
      return { points: hand.map((p) => ({ x: p.x, y: p.y, z: p.z })), side, score: cat?.score ?? 0 };
    });
    fillMissingHands(frame, found);
  }
  return frame;
}

// เส้นเชื่อมจุดของลำตัว มือ และใบหน้า (มาจาก MediaPipe)
export const POSE_CONNECTIONS = HolisticLandmarker.POSE_CONNECTIONS;
export const HAND_CONNECTIONS = HolisticLandmarker.HAND_CONNECTIONS;
export const FACE_CONTOURS = HolisticLandmarker.FACE_LANDMARKS_CONTOURS;
