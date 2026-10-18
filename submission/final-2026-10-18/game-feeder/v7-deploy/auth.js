/* TransitLab account registration, login, email verification and password reset. */
(function () {
  'use strict';
  var state = { mode: 'register', user: null, resetEmail: '' };
  function byId(id) { return document.getElementById(id); }
  function msg(text, good) { var el = byId('authMessage'); el.textContent = text || ''; el.className = good ? 'auth-message good' : 'auth-message'; }
  function api(path, body) {
    var base = window.TL_API_BASE || '';
    var opts = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
    return fetch(base + path, opts).then(function (r) {
      return r.text().then(function (text) {
        var d; try { d = text ? JSON.parse(text) : {}; } catch (ignore) { d = {}; }
        if (!r.ok) throw new Error((d.detail && d.detail.message) || d.detail || '账号服务暂时不可用');
        return d;
      });
    });
  }
  function ensureUI() {
    if (!byId('accountBtn')) {
      var top = byId('topbar');
      if (!top) return;
      var button = document.createElement('button');
      button.className = 'btn btn-sm account-button'; button.id = 'accountBtn'; button.type = 'button'; button.textContent = '注册 / 登录';
      var spacer = top.querySelector('.sp');
      if (spacer) top.insertBefore(button, spacer); else top.appendChild(button);
    }
    if (!byId('authDialog')) {
      var shell = document.createElement('div');
      shell.innerHTML = '<div id="authDialog" class="auth-dialog" hidden>' +
        '<button class="close" id="authClose" type="button" aria-label="关闭">×</button>' +
        '<div class="auth-brand"><span class="auth-mark">TL</span><span>TransitLab HK</span></div>' +
        '<h2 id="authTitle">创建规划账号</h2><p class="auth-lede">保存你的接驳方案、成绩和学习记录。</p>' +
        '<div class="auth-tabs" role="tablist"><button id="authLoginTab" type="button">登录</button><button id="authRegisterTab" type="button">注册</button></div>' +
        '<form id="authForm" class="auth-form">' +
        '<label id="authUsernameField">用户名<input id="authUsername" name="username" autocomplete="username" maxlength="20"></label>' +
        '<label id="authLoginField" hidden>邮箱或用户名<input id="authLogin" name="login" autocomplete="username"></label>' +
        '<label id="authEmailField">邮箱<input id="authEmail" name="email" type="email" autocomplete="email"></label>' +
        '<label>密码<input id="authPassword" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位，含字母和数字"></label>' +
        '<label id="authPassword2Field">确认密码<input id="authPassword2" name="password2" type="password" autocomplete="new-password"></label>' +
        '<label id="authCodeField" hidden>邮箱验证码<input id="authCode" name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"></label>' +
        '<label id="authResetEmailField" hidden>注册邮箱<input id="authResetEmail" name="resetEmail" type="email" autocomplete="email"></label>' +
        '<label id="authResetCodeField" hidden>邮箱验证码<input id="authResetCode" name="resetCode" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"></label>' +
        '<label id="authResetPasswordField" hidden>新密码<input id="authResetPassword" name="resetPassword" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位，含字母和数字"></label>' +
        '<label id="authResetPassword2Field" hidden>确认新密码<input id="authResetPassword2" name="resetPassword2" type="password" autocomplete="new-password"></label>' +
        '<p id="authMessage" class="auth-message" role="status"></p><button class="btn btn-p auth-submit" id="authSubmit" type="submit">创建账号</button></form>' +
        '<div class="auth-foot"><button class="auth-link" id="authModeSwitch" type="button">已有账号？登录</button><button class="auth-link" id="authForgot" type="button" hidden>忘记密码？</button><button class="auth-link" id="authResend" type="button" hidden>重新发送验证码</button></div></div>';
      document.body.appendChild(shell.firstElementChild);
    }
  }
  function render() {
    var mode = state.mode;
    var login = mode === 'login', register = mode === 'register', verify = mode === 'verify', forgot = mode === 'forgot', reset = mode === 'reset';
    var flow = verify || forgot || reset;
    byId('authTitle').textContent = login ? '欢迎回来' : verify ? '验证你的邮箱' : forgot ? '找回密码' : reset ? '设置新密码' : '创建规划账号';
    byId('authLoginTab').className = login ? 'active' : '';
    byId('authRegisterTab').className = register ? 'active' : '';
    byId('authLoginTab').hidden = flow; byId('authRegisterTab').hidden = flow;
    byId('authUsernameField').hidden = !register;
    byId('authLoginField').hidden = !login;
    byId('authEmailField').hidden = !register;
    byId('authPassword').parentElement.hidden = !(login || register);
    byId('authPassword2Field').hidden = !register;
    byId('authCodeField').hidden = !verify;
    byId('authResetEmailField').hidden = !(forgot || reset);
    byId('authResetCodeField').hidden = !reset;
    byId('authResetPasswordField').hidden = !reset;
    byId('authResetPassword2Field').hidden = !reset;
    if (state.resetEmail) byId('authResetEmail').value = state.resetEmail;
    byId('authSubmit').textContent = login ? '登录' : verify ? '验证邮箱' : forgot ? '发送验证码' : reset ? '保存新密码' : '创建账号';
    byId('authResend').hidden = !(verify || reset);
    byId('authForgot').hidden = !login;
    byId('authModeSwitch').hidden = verify;
    byId('authModeSwitch').textContent = (forgot || reset) ? '返回登录' : login ? '还没有账号？立即注册' : '已有账号？登录';
  }
  function open(mode) { state.mode = mode || 'register'; render(); msg(''); byId('authDialog').hidden = false; }
  function account(user) { state.user = user || null; byId('accountBtn').textContent = user ? '账户 · ' + user.username : '注册 / 登录'; }
  function init() {
    ensureUI();
    var dialog = byId('authDialog'); if (!dialog || !byId('accountBtn')) return;
    window.TL_AUTH = { open: open, getUser: function () { return state.user; } };
    byId('accountBtn').addEventListener('click', function () { open(state.user ? 'login' : 'register'); });
    byId('authClose').addEventListener('click', function () { dialog.hidden = true; });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.hidden = true; });
    byId('authLoginTab').addEventListener('click', function () { state.mode = 'login'; render(); msg(''); });
    byId('authRegisterTab').addEventListener('click', function () { state.mode = 'register'; render(); msg(''); });
    byId('authModeSwitch').addEventListener('click', function () { state.mode = (state.mode === 'login') ? 'register' : 'login'; render(); msg(''); });
    byId('authForgot').addEventListener('click', function () { state.mode = 'forgot'; state.resetEmail = ''; render(); msg(''); });
    byId('authResend').addEventListener('click', function () {
      var promise = state.mode === 'reset' ? api('/api/auth/forgot', { email: byId('authResetEmail').value.trim() }) : api('/api/auth/resend', {});
      promise.then(function () { msg(state.mode === 'reset' ? '如果邮箱已注册，新的验证码已发送。' : '验证码已重新发送。', true); }).catch(function (e) { msg(e.message); });
    });
    byId('authForm').addEventListener('submit', function (event) {
      event.preventDefault(); var submit = byId('authSubmit'); submit.disabled = true; msg('正在处理…');
      var promise;
      if (state.mode === 'login') {
        promise = api('/api/auth/login', { login: byId('authLogin').value.trim(), password: byId('authPassword').value });
      } else if (state.mode === 'verify') {
        promise = api('/api/auth/verify', { code: byId('authCode').value.trim() });
      } else if (state.mode === 'forgot') {
        state.resetEmail = byId('authResetEmail').value.trim();
        if (!state.resetEmail) { msg('请输入注册邮箱'); submit.disabled = false; return; }
        promise = api('/api/auth/forgot', { email: state.resetEmail });
      } else if (state.mode === 'reset') {
        if (byId('authResetPassword').value !== byId('authResetPassword2').value) { msg('两次新密码不一致'); submit.disabled = false; return; }
        promise = api('/api/auth/reset', { email: byId('authResetEmail').value.trim(), code: byId('authResetCode').value.trim(), password: byId('authResetPassword').value });
      } else {
        if (byId('authPassword').value !== byId('authPassword2').value) { msg('两次密码不一致'); submit.disabled = false; return; }
        promise = api('/api/auth/register', { username: byId('authUsername').value.trim(), email: byId('authEmail').value.trim(), password: byId('authPassword').value });
      }
      promise.then(function (data) {
        if (state.mode === 'register') {
          state.user = data.user;
          if (data.email_sent) { state.mode = 'verify'; render(); msg('验证码已发送到你的邮箱。', true); }
          else { account(data.user); msg('账号已创建。服务器未配置邮箱时，演示账号会直接启用。', true); setTimeout(function () { dialog.hidden = true; }, 700); }
        }
        else if (state.mode === 'verify') { account(data.user); msg('邮箱验证成功。', true); setTimeout(function () { dialog.hidden = true; }, 700); }
        else if (state.mode === 'forgot') { state.mode = 'reset'; render(); msg(data.email_sent ? '验证码已发送到邮箱，请输入验证码。' : '如果邮箱已注册，验证码已发送。', true); }
        else if (state.mode === 'reset') { account(data.user); msg('密码已更新，登录成功。', true); setTimeout(function () { dialog.hidden = true; }, 700); }
        else { account(data.user); msg('登录成功。', true); setTimeout(function () { dialog.hidden = true; }, 500); }
      }).catch(function (e) { msg(e.message); }).then(function () { submit.disabled = false; });
    });
    render(); api('/api/auth/me').then(function (data) { if (data.user) account(data.user); }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
