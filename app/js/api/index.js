// 설정에 따라 데모 백엔드 또는 Supabase 백엔드를 골라요.
import { isDemo } from '../config.js';

let backend = null;

export async function getApi() {
  if (backend) return backend;
  if (isDemo) {
    const { demo } = await import('./demo.js');
    backend = demo;
  } else {
    const { supabaseBackend } = await import('./supabase.js');
    backend = supabaseBackend;
  }
  await backend.init();
  return backend;
}
