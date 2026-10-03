import { createApp } from 'vue';
import Vant, { showToast } from 'vant';
import { createDiagnostics } from './core/diagnostics.js';
import 'vant/lib/index.css';
import './style.css';
import App from './App.vue';

const app = createApp(App).use(Vant);
app.config.errorHandler = () => {
  let storage;
  try { storage = globalThis.localStorage; } catch { /* Diagnostics remain optional. */ }
  createDiagnostics(storage).record('UNEXPECTED_ERROR');
  showToast('页面出现异常，请重新打开后重试；可在设置中导出诊断日志。');
};
app.mount('#app');
