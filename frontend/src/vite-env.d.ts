/// <reference types="vite/client" />

// ประกาศชนิดของตัวแปร env ที่หน้าเว็บใช้
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
