// yoztea-ym 柚子姨妈 — 主逻辑
// 风格 & 结构仿 sakura-countdown

const LS_TOKEN = 'yoztea-ym.token';
const LS_REPO = 'yoztea-ym.repo';
const RAW_BASE = 'https://raw.githubusercontent.com';
const API_BASE = 'https://api.github.com/repos';
const DATA_PATH = 'data/period.json';
const DEFAULT_CYCLE = 28;
const REFRESH_MS = 5 * 60 * 1000;
const FLOW_LABEL = { light: '轻 💧', medium: '中 🌸', heavy: '多 🩸' };

// ---- 工具 ----
export function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / ms);
}

export function todayStr() {
  const t = new Date();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
}

// 平均周期(天):相邻 start 之差;不足 2 条返回默认值
export function avgCycle(periods) {
  if (!Array.isArray(periods) || periods.length < 2) return DEFAULT_CYCLE;
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  let sum = 0;
  for (let i = 1; i < sorted.length; i++) {
    sum += daysBetween(sorted[i - 1].start, sorted[i].start);
  }
  return Math.round(sum / (sorted.length - 1));
}

// 找今天所在的 period
export function currentPeriod(periods, today) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const t = today || todayStr();
  return periods.find((p) => {
    if (!p.start) return false;
    const start = p.start;
    const end = p.end || p.start;
    return t >= start && t <= end;
  }) || null;
}

// 最近一次开始过的 period(用于预测下次)
export function lastStarted(periods, today) {
  const t = today || todayStr();
  const past = periods.filter((p) => p.start && p.start <= t);
  if (past.length === 0) return null;
  return past.sort((a, b) => b.start.localeCompare(a.start))[0];
}

// 状态:{ kind: 'in'|'coming'|'none', period, days, nextDate }
export function status(periods, today) {
  const t = today || todayStr();
  if (!Array.isArray(periods) || periods.length === 0) {
    return { kind: 'none' };
  }
  const cur = currentPeriod(periods, t);
  if (cur) {
    return { kind: 'in', period: cur, days: daysBetween(cur.start, t) + 1 };
  }
  const last = lastStarted(periods, t);
  if (!last) return { kind: 'none' };
  const cycle = avgCycle(periods);
  const next = new Date(last.start + 'T00:00:00');
  next.setDate(next.getDate() + cycle);
  const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const remain = daysBetween(t, nextStr);
  if (remain < 0) return { kind: 'none' };
  return { kind: 'coming', period: last, days: remain, nextDate: nextStr, cycle };
}

// ---- GitHub 读写 ----
function getRepoConfig() {
  let repo = localStorage.getItem(LS_REPO);
  if (!repo) {
    // 尝试从 origin 推断:username.github.io/repo
    const m = location.host.match(/^([^.]+)\.github\.io\/?(.*)$/);
    if (m) {
      const owner = m[1];
      const path = location.pathname.replace(/^\/+|\/+$/g, '');
      if (path) repo = `${owner}/${path}`;
    }
  }
  return repo;
}

function getToken() {
  return localStorage.getItem(LS_TOKEN) || '';
}

export function isAdmin() {
  return !!getToken() && !!getRepoConfig();
}

export async function readData() {
  const repo = getRepoConfig();
  if (!repo) return { periods: [], updatedAt: null, noConfig: true };
  const url = `${RAW_BASE}/${repo}/main/${DATA_PATH}?t=${Date.now()}`;
  const res = await fetch(url);
  if (res.status === 404) return { periods: [], updatedAt: null };
  if (!res.ok) throw new Error(`读取失败 (${res.status})`);
  const data = await res.json();
  return data;
}

// 写入:GET sha → PUT
export async function writeData(nextData) {
  const repo = getRepoConfig();
  const token = getToken();
  if (!repo || !token) throw new Error('未配置 token 或仓库');
  const apiUrl = `${API_BASE}/${repo}/contents/${DATA_PATH}`;
  const nextJson = JSON.stringify(nextData, null, 2);
  const content = btoa(unescape(encodeURIComponent(nextJson)));

  let sha = undefined;
  // 拉取当前 sha(冲突时重试一次)
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    let metaJson;
    if (meta.status === 404) {
      sha = undefined;
    } else if (meta.ok) {
      metaJson = await meta.json();
      sha = metaJson.sha;
    } else if (meta.status === 401 || meta.status === 403) {
      throw new Error(`无权限 (${meta.status}),token 可能已过期`);
    } else {
      throw new Error(`读取元信息失败 (${meta.status})`);
    }

    const body = {
      message: `chore(period): update ${new Date().toISOString()}`,
      content,
    };
    if (sha) body.sha = sha;

    const put = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (put.ok) return await put.json();
    if (put.status === 409 && attempt === 0) {
      // sha 冲突,重试一次
      continue;
    }
    if (put.status === 401 || put.status === 403) {
      throw new Error(`无权限 (${put.status}),token 可能无权写入`);
    }
    const err = await put.json().catch(() => ({}));
    throw new Error(err.message || `写入失败 (${put.status})`);
  }
  throw new Error('多次冲突,稍后重试');
}

// ---- 内存状态 ----
const state = {
  data: { periods: [], updatedAt: null },
  current: 0,
  petalTimer: null,
  pollTimer: null,
  editingId: null, // 编辑时的记录 id
  flowValue: 'medium', // 模态框中当前选中经量
};

// ---- DOM ----
const $ = (s) => document.querySelector(s);

function currentPeriods() {
  return (state.data && state.data.periods) || [];
}

function currentEv() {
  const arr = currentPeriods();
  if (arr.length === 0) return null;
  return arr[state.current] || arr[arr.length - 1];
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- 渲染 ----
function renderAll() {
  renderStatus();
  renderDots();
}

function renderStatus() {
  const arr = currentPeriods();
  const ev = currentEv();
  const st = status(arr, todayStr());

  if (arr.length === 0) {
    $('#ym-title').textContent = '还没有记录';
    $('#ym-days').textContent = '--';
    $('#ym-days-label').textContent = '天';
    $('#ym-cycle').textContent = '--';
    $('#ym-meta').hidden = true;
    stopPetals();
    return;
  }

  // 当前看的记录卡片
  if (ev) {
    const flowText = FLOW_LABEL[ev.flow] || '';
    const noteText = ev.note ? ev.note : '';
    if (ev === st.period && st.kind === 'in') {
      $('#ym-title').textContent = `姨妈第 ${st.days} 天`;
      $('#ym-days').textContent = st.days;
      $('#ym-days-label').textContent = '天';
      startPetals();
    } else if (ev === st.period && st.kind === 'coming') {
      // 查看的是最新一条(预测基准):主卡片显示距下次姨妈
      $('#ym-title').textContent = '距下次姨妈';
      $('#ym-days').textContent = st.days;
      $('#ym-days-label').textContent = '天';
      stopPetals();
    } else {
      // 查看历史记录:距今天多少天
      const d = daysBetween(ev.start, todayStr());
      if (d === 0) {
        $('#ym-title').textContent = `姨妈第 1 天`;
        $('#ym-days').textContent = 1;
      } else if (d > 0) {
        $('#ym-title').textContent = `${Math.abs(d)} 天前开始`;
        $('#ym-days').textContent = Math.abs(d);
      } else {
        // 未来记录
        $('#ym-title').textContent = `${Math.abs(d)} 天后开始`;
        $('#ym-days').textContent = Math.abs(d);
      }
      $('#ym-days-label').textContent = '天';
      stopPetals();
    }
    $('#ym-cycle').textContent = avgCycle(arr);
    if (flowText || noteText) {
      $('#ym-meta').hidden = false;
      $('#ym-flow').textContent = flowText;
      $('#ym-note').textContent = noteText || '';
      $('#ym-note').hidden = !noteText;
    } else {
      $('#ym-meta').hidden = true;
    }
  }

  // 全局状态提示(底部 hint)
  const hint = $('#ym-hint');
  if (st.kind === 'coming' && st.period !== ev) {
    hint.hidden = false;
    hint.textContent = `距下次姨妈约 ${st.days} 天 · 预计 ${st.nextDate}`;
  } else if (st.kind === 'in' && st.period !== ev) {
    hint.hidden = false;
    hint.textContent = `正在进行:姨妈第 ${st.days} 天`;
  } else {
    hint.hidden = true;
  }
}

function renderDots() {
  const host = $('#ym-dots');
  host.innerHTML = '';
  const arr = currentPeriods();
  arr.forEach((ev, i) => {
    const dot = document.createElement('button');
    dot.className = 'dot' + (i === state.current ? ' dot-on' : '');
    dot.setAttribute('aria-label', `切换到 ${ev.start}`);
    dot.addEventListener('click', () => {
      setCurrent(i, i > state.current ? 1 : -1);
    });
    // 长按(仅管理员)→ 编辑/删除
    if (isAdmin()) {
      let pressTimer = null;
      const startPress = (e) => {
        e.preventDefault();
        pressTimer = setTimeout(() => {
          openAction(ev.id);
        }, 550);
      };
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      dot.addEventListener('mousedown', startPress);
      dot.addEventListener('touchstart', startPress, { passive: false });
      dot.addEventListener('mouseup', cancelPress);
      dot.addEventListener('mouseleave', cancelPress);
      dot.addEventListener('touchend', cancelPress);
      dot.addEventListener('touchcancel', cancelPress);
    }
    host.appendChild(dot);
  });
}

function setCurrent(next, direction) {
  if (next === state.current) return;
  const card = document.querySelector('.card');
  if (direction !== 0 && card) {
    card.classList.remove('anim-next', 'anim-prev');
    void card.offsetWidth;
    card.classList.add(direction > 0 ? 'anim-next' : 'anim-prev');
    setTimeout(() => card.classList.remove('anim-next', 'anim-prev'), 260);
  }
  state.current = next;
  renderAll();
}

// ---- 樱花瓣 ----
function startPetals() {
  if (state.petalTimer) return;
  const host = $('#ym-petals');
  host.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('span');
    p.className = 'petal';
    p.style.left = (10 + i * 30) + '%';
    p.style.animationDelay = (i * 1.6) + 's';
    host.appendChild(p);
  }
  state.petalTimer = setInterval(() => {
    host.querySelectorAll('.petal').forEach((p) => {
      p.style.animation = 'none';
      void p.offsetWidth;
      p.style.animation = '';
    });
  }, 5000);
}

function stopPetals() {
  if (state.petalTimer) {
    clearInterval(state.petalTimer);
    state.petalTimer = null;
  }
  $('#ym-petals').innerHTML = '';
}

// ---- 模态框 ----
function openModal(ev) {
  state.editingId = ev ? ev.id : null;
  $('#ym-modal-title').textContent = ev ? '编辑记录' : '新增记录';
  $('#ym-in-start').value = ev ? ev.start : todayStr();
  $('#ym-in-end').value = ev ? ev.end || '' : '';
  $('#ym-in-note').value = ev ? ev.note || '' : '';
  state.flowValue = ev ? ev.flow || 'medium' : 'medium';
  syncFlowButtons();
  $('#ym-modal').hidden = false;
  setTimeout(() => $('#ym-in-start').focus(), 50);
}

function closeModal() {
  $('#ym-modal').hidden = true;
  state.editingId = null;
}

function syncFlowButtons() {
  document.querySelectorAll('#ym-in-flow .chip-btn').forEach((b) => {
    b.classList.toggle('chip-on', b.dataset.flow === state.flowValue);
  });
}

async function saveRecord() {
  const start = $('#ym-in-start').value;
  const end = $('#ym-in-end').value;
  const note = $('#ym-in-note').value.trim();
  if (!start) {
    alert('开始日期必填');
    return;
  }
  if (end && end < start) {
    alert('结束日期不能早于开始日期');
    return;
  }
  const rec = {
    id: state.editingId || makeId(),
    start,
    end: end || '',
    flow: state.flowValue,
    note,
  };

  let periods = currentPeriods().slice();
  if (state.editingId) {
    periods = periods.map((p) => (p.id === state.editingId ? rec : p));
  } else {
    periods.push(rec);
  }
  periods.sort((a, b) => b.start.localeCompare(a.start));

  closeModal();
  try {
    const nextData = { periods, updatedAt: new Date().toISOString() };
    await writeData(nextData);
    state.data = nextData;
    // 选中刚保存的
    const idx = periods.findIndex((p) => p.id === rec.id);
    state.current = Math.max(0, idx);
    renderAll();
  } catch (e) {
    alert('保存失败:' + e.message);
  }
}

function openAction(id) {
  const ev = currentPeriods().find((p) => p.id === id);
  if (!ev) return;
  state.editingId = id;
  $('#ym-action-date').textContent = `${ev.start}${ev.end ? ' ~ ' + ev.end : ''}`;
  $('#ym-action').hidden = false;
}

function closeAction() {
  $('#ym-action').hidden = true;
  state.editingId = null;
}

async function deleteCurrent() {
  const id = state.editingId;
  if (!id) return;
  if (!confirm('删除这条记录?')) return;
  closeAction();
  try {
    const periods = currentPeriods().filter((p) => p.id !== id);
    const nextData = { periods, updatedAt: new Date().toISOString() };
    await writeData(nextData);
    state.data = nextData;
    if (state.current >= periods.length) {
      state.current = Math.max(0, periods.length - 1);
    }
    renderAll();
  } catch (e) {
    alert('删除失败:' + e.message);
  }
}

// ---- 设置 ----
function openSettings() {
  $('#ym-in-repo').value = getRepoConfig() || '';
  $('#ym-in-token').value = getToken();
  $('#ym-status').textContent = isAdmin() ? '当前:管理员模式 ✓' : '当前:只读模式';
  $('#ym-settings').hidden = false;
}

function closeSettings() {
  $('#ym-settings').hidden = true;
}

function saveSettings() {
  const repo = $('#ym-in-repo').value.trim();
  const token = $('#ym-in-token').value.trim();
  if (repo) localStorage.setItem(LS_REPO, repo);
  if (token) localStorage.setItem(LS_TOKEN, token);
  closeSettings();
  bootstrap();
}

function clearSettings() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_REPO);
  $('#ym-in-token').value = '';
  $('#ym-in-repo').value = '';
  $('#ym-status').textContent = '已清除,当前:只读模式';
  closeSettings();
  bootstrap();
}

// ---- 拉取 + 轮询 ----
async function refresh() {
  try {
    const data = await readData();
    // 统一按开始日期降序排,最新在前
    if (Array.isArray(data.periods)) {
      data.periods = data.periods.slice().sort((a, b) => b.start.localeCompare(a.start));
    }
    state.data = data;
    // 保持 current 在范围内
    const len = (data.periods || []).length;
    if (state.current >= len) state.current = Math.max(0, len - 1);
    renderAll();
  } catch (e) {
    $('#ym-title').textContent = '读取失败';
    console.error(e);
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

// ---- 启动 ----
function bootstrap() {
  // 模式切换
  const admin = isAdmin();
  $('#ym-add').hidden = !admin;
  if (admin) {
    $('#ym-gear').setAttribute('title', '管理员模式');
  }

  // 绑定事件(只绑一次)
  if (!bootstrap._bound) {
    bootstrap._bound = true;
    $('#ym-add').addEventListener('click', () => openModal(null));
    $('#ym-cancel').addEventListener('click', closeModal);
    $('#ym-save').addEventListener('click', saveRecord);
    $('#ym-modal').addEventListener('click', (e) => {
      if (e.target.id === 'ym-modal') closeModal();
    });
    document.querySelectorAll('#ym-in-flow .chip-btn').forEach((b) => {
      b.addEventListener('click', () => {
        state.flowValue = b.dataset.flow;
        syncFlowButtons();
      });
    });

    $('#ym-gear').addEventListener('click', openSettings);
    $('#ym-ok').addEventListener('click', saveSettings);
    $('#ym-clear').addEventListener('click', clearSettings);
    $('#ym-settings').addEventListener('click', (e) => {
      if (e.target.id === 'ym-settings') closeSettings();
    });

    $('#ym-action-edit').addEventListener('click', () => {
      const id = state.editingId;
      closeAction();
      const ev = currentPeriods().find((p) => p.id === id);
      if (ev) openModal(ev);
    });
    $('#ym-action-del').addEventListener('click', deleteCurrent);
    $('#ym-action-cancel').addEventListener('click', closeAction);
    $('#ym-action').addEventListener('click', (e) => {
      if (e.target.id === 'ym-action') closeAction();
    });

    // 左右滑动切换
    let touchStart = null;
    const SWIPE_THRESHOLD = 40;
    const card = document.querySelector('.card');
    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('.add-btn, .dot, .gear, .modal, .modal-card, input, textarea, button')) return;
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const dt = Date.now() - touchStart.time;
      touchStart = null;
      if (dt > 600) return;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const arr = currentPeriods();
      if (dx < 0 && state.current < arr.length - 1) setCurrent(state.current + 1, 1);
      else if (dx > 0 && state.current > 0) setCurrent(state.current - 1, -1);
    });
  }

  refresh().then(startPolling);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
