/* 令牌 / 用量 / 我的 / 兑换 / 充值 / 邀请 */
(function (global) {
  'use strict';
  var U = global.U;
  var C = global.PagesCore;
  var h = C.h, section = C.section, listItem = C.listItem, emptyState = C.emptyState, card = C.card;
  var arrOf = C.arrOf, pick = C.pick, balanceOf = C.balanceOf, open = C.open;

  function needLogin() {
    var box = h('div', { class: 'page' },
      emptyState('请先登录', '登录后即可管理你的账户与令牌', 'lock'),
      h('div', { style: { maxWidth: '320px', margin: '0 auto' } },
        h('button', { class: 'btn btn-primary btn-block', onclick: function () { App.go('#/login'); } }, '去登录'),
        h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onclick: function () { App.go('#/register'); } }, '注册新账号')
      )
    );
    return box;
  }

  // ---------------- keys ----------------
  function statusBadge(k) {
    var st = String(k.status || 'active');
    var map = {
      active: ['正常', 'ok'], inactive: ['已停用', ''], disabled: ['已停用', ''],
      expired: ['已过期', 'warn'], quota_exhausted: ['额度用尽', 'danger']
    };
    var m = map[st] || [st, ''];
    return h('span', { class: 'badge ' + m[1] }, m[0]);
  }

  function keyCard(k, reload) {
    var quota = Number(pick(k, 'quota', 'total_quota', 'quota_limit') || 0);
    var used = Number(pick(k, 'used_quota', 'quota_used', 'used') || 0);
    var pct = quota > 0 ? Math.min(100, Math.round(used / quota * 100)) : 0;
    var group = pick(k, 'group_name') || (k.group && k.group.name) ||
      (global.S && global.S.groupNames && global.S.groupNames[k.group_id]) ||
      (k.group_id ? '分组 #' + k.group_id : '默认分组');
    var exp = pick(k, 'expires_at', 'expired_at');

    var children = [
      h('div', { class: 'keycard-top' },
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', { class: 'keycard-name nowrap', onclick: function (e) { e.stopPropagation(); openKeyDetail(k); } }, k.name || '未命名令牌', h('span', { class: 'tiny muted', style: { marginLeft: '6px' } }, '›')),
          h('div', { class: 'keycard-key' },
            h('span', { class: 'mono' }, U.maskKey(k.key || '')),
            h('button', {
              class: 'icon-btn', style: { width: '28px', height: '28px' },
              html: U.ic('copy', 15),
              onclick: function (e) { e.stopPropagation(); U.copy(k.key || ''); }
            })
          )
        ),
        statusBadge(k)
      ),
      quota > 0
        ? h('div', null,
            h('div', { class: 'row between', style: { marginBottom: '5px' } },
              h('span', { class: 'tiny muted' }, '已用 ' + U.credits(used) + ' / ' + U.credits(quota)),
              h('span', { class: 'tiny muted' }, pct + '%')),
            h('div', { class: 'progress' + (pct > 90 ? ' danger' : pct > 70 ? ' warn' : '') }, h('i', { style: { width: pct + '%' } })))
        : h('div', { class: 'tiny muted' }, '额度不限'),
      h('div', { class: 'meta-grid' },
        h('div', null, '分组', h('b', { class: 'nowrap' }, group)),
        h('div', null, '创建', h('b', null, U.date(pick(k, 'created_at', 'createdAt')))),
        h('div', null, '到期', h('b', null, exp ? U.date(exp) : '永不'))
      ),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', {
          class: 'btn btn-sm', style: { flex: '1' },
          onclick: function () { openKeyEditor(k, reload); }
        }, '编辑'),
        h('button', {
          class: 'btn btn-sm', style: { flex: '1' },
          onclick: function (e) {
            e.stopPropagation();
            var next = String(k.status) === 'inactive' ? 'active' : 'inactive';
            Api.keyUpdate(k.id, { status: next }).then(function () {
              U.toast(next === 'active' ? '已启用' : '已停用', 'ok');
              reload();
            }).catch(function (err) { U.toast(err.message, 'err'); });
          }
        }, String(k.status) === 'inactive' ? '启用' : '停用'),
        h('button', {
          class: 'btn btn-sm btn-danger', style: { flex: '1' },
          onclick: function (e) {
            e.stopPropagation();
            U.confirm('删除令牌', '删除后使用该令牌的客户端将立即失效，且不可恢复。', '删除', true).then(function (ok) {
              if (!ok) return;
              Api.keyDelete(k.id).then(function () {
                U.toast('已删除', 'ok');
                reload();
              }).catch(function (err) { U.toast(err.message, 'err'); });
            });
          }
        }, '删除')
      )
    ];
    if (String(k.status) !== 'active') children[0].style.opacity = '0.72';
    return h('div', { class: 'card', style: { marginBottom: '10px' } }, h('div', { class: 'keycard' }, children));
  }

  function openKeyDetail(k) {
    var base = Api.ORIGIN + '/v1';
    var curl = 'curl ' + base + '/chat/completions \\\n  -H "Authorization: Bearer ' + (k.key || 'YOUR_KEY') + '" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"MODEL","messages":[{"role":"user","content":"Hello"}]}\'';
    var body = h('div', null,
      h('div', { class: 'kv' }, h('span', null, '名称'), h('b', null, k.name || '未命名')),
      h('div', { class: 'kv' }, h('span', null, '状态'), h('b', null, String(k.status || 'active'))),
      h('div', { class: 'kv' }, h('span', null, 'Base URL'), h('b', { class: 'mono', style: { fontSize: '11.5px' } }, base)),
      h('div', { class: 'kv' }, h('span', null, '令牌'), h('b', { class: 'mono', style: { fontSize: '11.5px' } }, k.key || '—')),
      h('div', { class: 'divider' }),
      h('div', { class: 'tiny muted', style: { marginBottom: '6px' } }, 'curl 示例'),
      h('pre', { class: 'mono', style: { background: 'var(--surface-2)', padding: '10px', borderRadius: '10px', fontSize: '10.5px', overflowX: 'auto', whiteSpace: 'pre' } }, curl),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-sm', style: { flex: '1' }, onclick: function () { U.copy(base); } }, '复制 Base URL'),
        h('button', { class: 'btn btn-sm', style: { flex: '1' }, onclick: function () { U.copy(k.key || ''); } }, '复制令牌'),
        h('button', { class: 'btn btn-sm', style: { flex: '1' }, onclick: function () { U.copy(curl); } }, '复制 curl')
      ),
      h('div', { class: 'notice', style: { marginTop: '12px' } }, '兼容 OpenAI / Anthropic 协议，可直接填入 Cherry Studio、ChatBox、Cline 等客户端。')
    );
    U.sheet({ title: '令牌与客户端配置', body: body, actions: [{ label: '关闭' }] });
  }

  function renderKeys() {
    if (!Api.AUTH.isLogged()) return needLogin();
    var page = h('div', { class: 'page' });
    var host = h('div', { style: { marginTop: '10px' } });
    page.appendChild(h('div', { class: 'row between', style: { marginBottom: '4px' } },
      h('div', { class: 'tiny muted' }, '令牌用于调用 API，请勿泄露给他人'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: function () { openKeyEditor(null, reload); } },
        h('span', { html: U.ic('plus', 14) }), '新建')
    ));
    page.appendChild(host);

    function reload() {
      host.innerHTML = '';
      host.appendChild(h('div', { class: 'card pad' }, h('div', { class: 'skeleton', style: { height: '60px' } })));
      if (!global.S.groupNames) global.S.groupNames = {};
      Api.groups().then(function (gs) {
        arrOf(gs).forEach(function (g) { global.S.groupNames[g.id] = g.name; });
      }).catch(function () {});
      Api.keys(1, 100).then(function (d) {
        var items = arrOf(d);
        global.S.keys = items;
        host.innerHTML = '';
        if (!items.length) {
          host.appendChild(emptyState('还没有令牌', '创建一个令牌即可在客户端调用模型', 'key'));
          return;
        }
        items.forEach(function (k) { host.appendChild(keyCard(k, reload)); });
        host.appendChild(h('div', { class: 'card', style: { marginTop: '6px' } },
          h('div', { class: 'list-item', onclick: function () { U.copy(Api.ORIGIN + '/v1'); } },
            h('span', { class: 'li-icon', html: U.ic('external', 16) }),
            h('div', { class: 'li-body' },
              h('div', { class: 'li-title', style: { fontSize: '13px' } }, 'Base URL'),
              h('div', { class: 'li-sub mono' }, Api.ORIGIN + '/v1')),
            h('div', { class: 'li-tail', html: U.ic('copy', 16) })
          )));
      }).catch(function (e) {
        host.innerHTML = '';
        host.appendChild(emptyState('加载失败', e.message, 'alert'));
      });
    }
    reload();
    return page;
  }

  function openKeyEditor(k, reload) {
    var isEdit = !!k;
    var groups = [];
    var name = h('input', { class: 'input', placeholder: '例如：我的电脑', value: (k && k.name) || '' });
    var groupSel = h('select', { class: 'select' }, h('option', { value: '' }, '默认分组（加载中…）'));
    var quota = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: '不限额度', value: k && k.quota ? String(k.quota) : '' });
    var exp = h('input', { class: 'input', type: 'date', value: k && k.expires_at ? U.date(k.expires_at) : '' });
    var custom = isEdit ? null : h('input', { class: 'input', placeholder: '留空自动生成（可选）' });

    Api.groups().then(function (d) {
      groups = arrOf(d);
      groupSel.innerHTML = '';
      groupSel.appendChild(h('option', { value: '' }, '默认分组'));
      groups.forEach(function (g) {
        groupSel.appendChild(h('option', { value: String(g.id) }, g.name || ('分组 ' + g.id)));
      });
      if (k && k.group_id) groupSel.value = String(k.group_id);
    }).catch(function () {
      groupSel.innerHTML = '';
      groupSel.appendChild(h('option', { value: '' }, '默认分组'));
    });

    var body = h('div', null,
      h('div', { class: 'field' }, h('label', null, '名称'), name),
      h('div', { class: 'field' }, h('label', null, '分组'), groupSel),
      h('div', { class: 'field' }, h('label', null, '额度（credits，留空不限）'), quota),
      h('div', { class: 'field' }, h('label', null, '到期时间（可选）'), exp),
      custom ? h('div', { class: 'field' }, h('label', null, '自定义令牌（可选）'), custom) : null
    );

    U.sheet({
      title: isEdit ? '编辑令牌' : '新建令牌',
      body: body,
      actions: [
        { label: '取消' },
        {
          label: isEdit ? '保存' : '创建',
          kind: 'primary',
          onClick: function () {
            if (!name.value.trim()) { U.toast('请填写名称', 'err'); return false; }
            var payload = { name: name.value.trim() };
            if (groupSel.value) payload.group_id = Number(groupSel.value);
            var qv = Number(quota.value);
            if (quota.value !== '' && isFinite(qv) && qv > 0) payload.quota = qv;
            if (exp.value) {
              var when = new Date(exp.value + 'T23:59:59');
              if (isEdit) {
                payload.expires_at = when.toISOString();
              } else {
                payload.expires_in_days = Math.max(1, Math.ceil((when.getTime() - Date.now()) / 86400000));
              }
            }
            if (custom && custom.value.trim()) payload.custom_key = custom.value.trim();
            var p = isEdit ? Api.keyUpdate(k.id, payload) : Api.keyCreate(payload);
            p.then(function (d) {
              if (!isEdit && d && d.key) {
                U.sheet({
                  title: '令牌创建成功',
                  body: h('div', null,
                    h('p', { class: 'small muted' }, '请立即复制保存，之后页面仅显示掩码。'),
                    h('div', { class: 'card pad mono small', style: { wordBreak: 'break-all' } }, d.key)),
                  actions: [
                    { label: '复制', onClick: function () { U.copy(d.key); } },
                    { label: '完成', kind: 'primary', onClick: function () {} }
                  ]
                });
              } else {
                U.toast(isEdit ? '已保存' : '已创建', 'ok');
              }
              if (reload) reload();
            }).catch(function (e) { U.toast(e.message, 'err'); });
            return true;
          }
        }
      ]
    });
  }

  // ---------------- usage ----------------
  function renderUsage() {
    if (!Api.AUTH.isLogged()) return needLogin();
    var page = h('div', { class: 'page' });
    var range = global.S.usageRange || 'today';
    var statsHost = h('div', { class: 'section' });
    var trendHost = h('div', { class: 'section' });
    var modelHost = h('div', { class: 'section' });
    var logsHost = h('div', { class: 'section' });
    var seg = h('div', { class: 'seg' }, [
      { k: 'today', t: '今日' }, { k: '7d', t: '近 7 天' }, { k: '30d', t: '近 30 天' }
    ].map(function (o) {
      return h('button', {
        class: range === o.k ? 'active' : '',
        onclick: function () {
          range = o.k; global.S.usageRange = o.k;
          Array.prototype.forEach.call(seg.children, function (b) { b.className = ''; });
          this.className = 'active';
          load();
        }
      }, o.t);
    }));

    page.appendChild(seg);
    page.appendChild(statsHost);
    page.appendChild(trendHost);
    page.appendChild(modelHost);
    page.appendChild(logsHost);

    function rangeQuery() {
      var end = new Date();
      var start = new Date();
      if (range === 'today') return { period: 'today' };
      start.setDate(end.getDate() - (range === '7d' ? 6 : 29));
      return { start_date: U.ymd(start), end_date: U.ymd(end) };
    }

    function load() {
      var q = rangeQuery();
      statsHost.innerHTML = '';
      statsHost.appendChild(h('div', { class: 'grid-2' },
        h('div', { class: 'card stat' }, h('b', { class: 'skeleton', style: { height: '22px', width: '50px', display: 'block' } }), h('span', null, '花费')),
        h('div', { class: 'card stat' }, h('b', { class: 'skeleton', style: { height: '22px', width: '50px', display: 'block' } }), h('span', null, '请求'))
      ));

      Api.usageStats(q).then(function (d) {
        var st = d || {};
        if (st.data && typeof st.data === 'object') st = st.data;
        if (st.stats && typeof st.stats === 'object') st = st.stats;
        var cost = Number(pick(st, 'total_cost', 'cost', 'credits_used', 'spend') || 0);
        var reqs = Number(pick(st, 'requests', 'request_count', 'total_requests', 'count') || 0);
        var inTok = Number(pick(st, 'input_tokens', 'prompt_tokens') || 0);
        var outTok = Number(pick(st, 'output_tokens', 'completion_tokens') || 0);
        statsHost.innerHTML = '';
        statsHost.appendChild(h('div', { class: 'grid-2' },
          h('div', { class: 'card stat' }, h('b', null, U.credits(cost)), h('span', null, '花费 · credits')),
          h('div', { class: 'card stat' }, h('b', null, U.num(reqs)), h('span', null, '请求数')),
          h('div', { class: 'card stat' }, h('b', null, U.tokens(inTok)), h('span', null, '输入 tokens')),
          h('div', { class: 'card stat' }, h('b', null, U.tokens(outTok)), h('span', null, '输出 tokens'))
        ));
      }).catch(function () {
        statsHost.innerHTML = '';
        statsHost.appendChild(h('div', { class: 'notice warn' }, '用量统计暂不可用'));
      });

      var tq = Object.assign({}, q);
      if (!tq.period) { tq.granularity = 'day'; }
      Api.usageTrend(tq).then(function (d) {
        var list = arrOf(d);
        if (!list.length && d && Array.isArray(d.series)) list = d.series;
        if (!list.length && d && Array.isArray(d.dates)) {
          var costs = d.costs || d.values || d.cost || [];
          list = d.dates.map(function (dt, i) { return { date: dt, cost: Number(costs[i] || 0) }; });
        }
        if (!list.length && d && Array.isArray(d.trend)) list = d.trend;
        if (!list.length && d && typeof d === 'object') {
          var keys = Object.keys(d).filter(function (k) { return Array.isArray(d[k]); });
          if (keys.length) list = d[keys[0]];
        }
        if (!list.length) { trendHost.innerHTML = ''; return; }
        trendHost.innerHTML = '';
        var vals = list.map(function (x) { return Number(pick(x, 'cost', 'total_cost', 'credits', 'value') || 0); });
        var max = Math.max.apply(null, vals.concat([0.000001]));
        trendHost.appendChild(section('消耗趋势', null, null, card(h('div', { style: { padding: '14px' } },
          h('div', { class: 'bars' }, list.slice(-30).map(function (x, i) {
            var v = Number(pick(x, 'cost', 'total_cost', 'credits', 'value') || 0);
            return h('i', null, h('b', { style: { height: Math.max(4, Math.round(v / max * 66)) + 'px' } }));
          })),
          h('div', { class: 'axis' },
            h('span', null, U.date(pick(list[0], 'date', 'day', 'bucket')) || ''),
            h('span', null, '峰值 ¥' + U.price(max))
          )
        ))));
      }).catch(function () {});

      Api.usageModels(tq).then(function (d) {
        var list = arrOf(d);
        if (!list.length) { modelHost.innerHTML = ''; return; }
        list.sort(function (a, b) { return Number(pick(b, 'total_cost', 'cost') || 0) - Number(pick(a, 'total_cost', 'cost') || 0); });
        var top = list.slice(0, 6);
        modelHost.innerHTML = '';
        modelHost.appendChild(section('模型消耗', null, null, card(top.map(function (m) {
          var cost = Number(pick(m, 'total_cost', 'cost') || 0);
          var reqs = Number(pick(m, 'requests', 'request_count', 'count') || 0);
          return h('div', { class: 'model-row' },
            h('div', { class: 'model-avatar' }, String(pick(m, 'model', 'name') || '?').slice(0, 2)),
            h('div', { style: { flex: '1', minWidth: '0' } },
              h('div', { class: 'model-name nowrap' }, pick(m, 'model', 'name') || '未知模型'),
              h('div', { class: 'model-sub' }, U.num(reqs) + ' 次请求')),
            h('div', { class: 'price' }, h('b', null, U.credits(cost)))
          );
        }))));
      }).catch(function () {});

      Api.usageLogs(Object.assign({ page: 1, page_size: 25 }, q)).then(function (d) {
        var list = arrOf(d);
        logsHost.innerHTML = '';
        logsHost.appendChild(section('调用记录', null, null,
          list.length ? card(list.map(function (log) {
            var ok = String(pick(log, 'status', 'status_code') || 'success');
            var bad = /error|fail|4\d\d|5\d\d/.test(ok);
            return h('div', { class: 'list-item' },
              h('span', { class: 'li-icon', style: { background: bad ? 'rgba(229,72,77,.1)' : '' }, html: U.ic(bad ? 'alert' : 'bolt', 16) }),
              h('div', { class: 'li-body' },
                h('div', { class: 'li-title nowrap', style: { fontSize: '13px' } }, pick(log, 'model', 'model_name') || '请求'),
                h('div', { class: 'li-sub' },
                  U.datetime(pick(log, 'created_at', 'timestamp', 'time')) + ' · ' +
                  U.tokens(Number(pick(log, 'total_tokens') || 0)) + ' tokens')
              ),
              h('div', { class: 'li-tail' }, h('span', { class: bad ? 'badge danger' : 'badge' }, '¥' + U.price(Number(pick(log, 'total_cost', 'cost', 'actual_cost') || 0))))
            );
          })) : emptyState('暂无记录', '发起调用后会显示在这里', 'chart')));
      }).catch(function () {});
    }
    load();
    return page;
  }

  // ---------------- me ----------------
  function renderMe() {
    if (!Api.AUTH.isLogged()) return needLogin();
    var page = h('div', { class: 'page' });
    var u = global.S.user || Api.AUTH.user() || {};
    var email = pick(u, 'email', 'username') || '—';
    var role = pick(u, 'role', 'user_role') || '';
    var roleText = /admin/.test(String(role)) ? '管理员' : (/observer/.test(String(role)) ? '观察者' : '用户');

    page.appendChild(h('div', { class: 'card pad' },
      h('div', { class: 'row' },
        h('div', {
          style: {
            width: '46px', height: '46px', borderRadius: '15px', background: 'var(--teal)',
            color: '#fff', display: 'grid', placeItems: 'center', fontSize: '19px', fontWeight: '700'
          }
        }, String(email).slice(0, 1).toUpperCase()),
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', { style: { fontWeight: '700' }, class: 'nowrap' }, email),
          h('div', { class: 'tiny muted' }, 'ID ' + (pick(u, 'id', 'user_id') || '—') + ' · ' + roleText)
        ),
        h('span', { class: 'badge teal' }, U.credits(balanceOf(u)) + ' credits')
      )
    ));

    page.appendChild(section(null, null, null, h('div', { class: 'grid-2' },
      h('button', { class: 'quick', style: { padding: '14px 6px' }, onclick: function () { App.go('#/purchase'); } },
        h('i', { html: U.ic('card', 18) }), h('span', null, '充值 credits')),
      h('button', { class: 'quick', style: { padding: '14px 6px' }, onclick: function () { App.go('#/redeem'); } },
        h('i', { html: U.ic('gift', 18) }), h('span', null, '兑换码'))
    )));

    page.appendChild(h('div', { class: 'section' }, h('div', { class: 'list' },
      listItem('key', '我的令牌', '创建与管理 API 令牌', null, function () { App.go('#/keys'); }),
      listItem('chart', '用量明细', '调用记录与消耗趋势', null, function () { App.go('#/usage'); }),
      listItem('card', '充值中心', 'credits 与订阅套餐', null, function () { App.go('#/purchase'); }),
      listItem('users', '邀请返利', '邀请好友获得返利', null, function () { App.go('#/affiliate'); })
    )));

    page.appendChild(h('div', { class: 'section' }, h('div', { class: 'list' },
      listItem('lock', '修改密码', '定期更换更安全', null, function () { openPasswordSheet(); }),
      listItem('refresh', '清除本地缓存', '重新拉取模型与公告', null, function () {
        Api.clearCache();
        U.toast('已清除', 'ok');
      })
    )));

    page.appendChild(h('div', { class: 'section' }, h('div', { class: 'list' },
      listItem('doc', '关于 PhuketAI', '版本、条款与联系方式', null, function () { App.go('#/about'); }),
      listItem('external', '完整网页版', '支付、画布、扭蛋等全部功能', null, function () { openInAppWeb(); }),
      listItem('external', '访问官网（浏览器）', Api.ORIGIN, null, function () { C.open(Api.ORIGIN); })
    )));

    page.appendChild(h('div', { class: 'section' },
      h('button', {
        class: 'btn btn-block btn-danger',
        onclick: function () {
          U.confirm('退出登录', '退出后需要重新输入账号密码。', '退出', true).then(function (ok) {
            if (!ok) return;
            Api.logout().then(function () {
              global.S.user = null;
              global.S.keys = [];
              U.toast('已退出', 'ok');
              App.go('#/home');
            });
          });
        }
      }, '退出登录')));

    page.appendChild(h('div', { class: 'footer-note' }, 'PhuketAI Android 1.0.0'));
    return page;
  }

  function openPasswordSheet() {
    var oldP = h('input', { class: 'input', type: 'password', placeholder: '当前密码' });
    var newP = h('input', { class: 'input', type: 'password', placeholder: '新密码（至少 8 位）' });
    var rep = h('input', { class: 'input', type: 'password', placeholder: '再次输入新密码' });
    U.sheet({
      title: '修改密码',
      body: h('div', null,
        h('div', { class: 'field' }, h('label', null, '当前密码'), oldP),
        h('div', { class: 'field' }, h('label', null, '新密码'), newP),
        h('div', { class: 'field' }, h('label', null, '确认新密码'), rep)
      ),
      actions: [
        { label: '取消' },
        {
          label: '保存', kind: 'primary', onClick: function () {
            if (!oldP.value || !newP.value) { U.toast('请填写完整', 'err'); return false; }
            if (newP.value.length < 8) { U.toast('新密码至少 8 位', 'err'); return false; }
            if (newP.value !== rep.value) { U.toast('两次输入不一致', 'err'); return false; }
            Api.changePassword(oldP.value, newP.value).then(function () {
              U.toast('密码已更新', 'ok');
              U.closeOverlay();
            }).catch(function (e) { U.toast(e.message, 'err'); });
            return true;
          }
        }
      ]
    });
  }

  // ---------------- redeem ----------------
  function renderRedeem() {
    if (!Api.AUTH.isLogged()) return needLogin();
    var page = h('div', { class: 'page' });
    var input = h('input', { class: 'input mono', placeholder: '输入兑换码，例如 ABCD-EFGH-1234', style: { textTransform: 'uppercase' } });
    var histHost = h('div', { class: 'section' });

    page.appendChild(h('div', { class: 'card pad' },
      h('div', { style: { fontSize: '16px', fontWeight: '700', marginBottom: '4px' } }, '兑换 credits'),
      h('div', { class: 'small muted', style: { marginBottom: '14px' } }, '输入有效的兑换码，额度将立即到账。'),
      input,
      h('button', {
        class: 'btn btn-primary btn-block', style: { marginTop: '12px' },
        onclick: function () {
          var code = input.value.trim();
          if (!code) { U.toast('请输入兑换码', 'err'); return; }
          Api.redeem(code).then(function (d) {
            var got = pick(d || {}, 'credits', 'amount', 'value', 'quota');
            U.toast(got ? '兑换成功 +' + got + ' credits' : '兑换成功', 'ok');
            input.value = '';
            loadHistory();
            App.refreshUser();
          }).catch(function (e) { U.toast(e.message, 'err'); });
        }
      }, '立即兑换')
    ));

    page.appendChild(histHost);

    function loadHistory() {
      histHost.innerHTML = '';
      Api.redeemHistory().then(function (d) {
        var list = arrOf(d);
        if (!list.length) return;
        histHost.appendChild(section('兑换记录', null, null, card(list.slice(0, 20).map(function (r) {
          return h('div', { class: 'list-item' },
            h('span', { class: 'li-icon', html: U.ic('gift', 16) }),
            h('div', { class: 'li-body' },
              h('div', { class: 'li-title', style: { fontSize: '13px' } }, pick(r, 'code', 'redeem_code') || '兑换码'),
              h('div', { class: 'li-sub' }, U.datetime(pick(r, 'created_at', 'used_at', 'time')))
            ),
            h('div', { class: 'li-tail' }, '+' + U.credits(Number(pick(r, 'credits', 'amount', 'value', 'quota') || 0)))
          );
        }))));
      }).catch(function () {});
    }
    loadHistory();
    return page;
  }

  // ---------------- purchase ----------------
  function renderPurchase() {
    var page = h('div', { class: 'page' });
    var plansHost = h('div', { class: 'section' });
    var ordersHost = h('div', { class: 'section' });

    page.appendChild(h('div', { class: 'card pad', style: { background: 'linear-gradient(135deg,#17a39c,#25292d)', color: '#fff', border: '0' } },
      h('div', { class: 'tiny', style: { opacity: '.8' } }, '当前余额'),
      h('div', { style: { fontSize: '28px', fontWeight: '700', letterSpacing: '-.5px' } },
        U.credits(balanceOf(global.S.user || {})) + ' credits'),
      h('div', { class: 'tiny', style: { opacity: '.8', marginTop: '2px' } }, '1 credits 等值 1 元人民币')
    ));

    page.appendChild(plansHost);
    page.appendChild(h('div', { class: 'section' },
      h('div', { class: 'grid-2' }, [50, 100, 200, 500].map(function (v) {
        return h('button', {
          class: 'card stat', style: { textAlign: 'left', cursor: 'pointer' },
          onclick: function () { openWebPay(v); }
        }, h('b', null, '¥' + v), h('span', null, v + ' credits · 立即充值 ›'));
      })) 
    ));

    page.appendChild(h('div', { class: 'notice', style: { marginTop: '12px' } },
      '支付由官方网页收银台完成（支持支付宝 / 微信 / 银行卡）。点击套餐会打开浏览器，支付后返回 App 刷新余额。'));

    page.appendChild(ordersHost);

    Api.paymentPlans().then(function (d) {
      var plans = arrOf(d);
      if (!plans.length) return;
      plansHost.appendChild(section('充值套餐', null, null, card(plans.map(function (p) {
        var name = pick(p, 'name', 'title') || '套餐';
        var price = Number(pick(p, 'price', 'amount', 'pay_amount') || 0);
        var credits = Number(pick(p, 'credits', 'credit_amount', 'quota') || 0);
        var bonus = Number(pick(p, 'bonus', 'bonus_credits', 'gift_credits') || 0);
        return h('div', { class: 'list-item', onclick: function () { openWebPay(price); } },
          h('span', { class: 'li-icon', html: U.ic('star', 16) }),
          h('div', { class: 'li-body' },
            h('div', { class: 'li-title' }, name),
            h('div', { class: 'li-sub' }, U.credits(credits) + ' credits' + (bonus ? ' · 赠 ' + bonus : ''))
          ),
          h('div', { class: 'li-tail' }, h('b', null, '¥' + U.price(price)))
        );
      }))));
    }).catch(function () {});

    Api.myOrders({ page: 1, page_size: 10 }).then(function (d) {
      var list = arrOf(d);
      if (!list.length) return;
      ordersHost.appendChild(section('我的订单', null, null, card(list.map(function (o) {
        var st = String(pick(o, 'status', 'trade_status') || '');
        var ok = /paid|success|completed/i.test(st);
        return h('div', { class: 'list-item' },
          h('span', { class: 'li-icon', html: U.ic('card', 16) }),
          h('div', { class: 'li-body' },
            h('div', { class: 'li-title mono', style: { fontSize: '12px' } }, pick(o, 'out_trade_no', 'order_no', 'id') || '订单'),
            h('div', { class: 'li-sub' }, U.datetime(pick(o, 'created_at', 'paid_at')))
          ),
          h('div', { class: 'li-tail' },
            h('span', { class: 'badge ' + (ok ? 'ok' : 'warn') }, ok ? '已支付' : (st || '待支付')),
            h('b', { style: { marginLeft: '6px' } }, '¥' + U.price(Number(pick(o, 'amount', 'pay_amount', 'price') || 0))))
        );
      }))));
    }).catch(function () {});

    return page;
  }

  function openWebPay(amount) {
    open(Api.ORIGIN + '/purchase?amount=' + encodeURIComponent(amount));
    U.toast('已在浏览器打开收银台');
  }

  // ---------------- affiliate ----------------
  function renderAffiliate() {
    if (!Api.AUTH.isLogged()) return needLogin();
    var page = h('div', { class: 'page' });
    var host = h('div', null);
    page.appendChild(host);
    Api.aff().then(function (d) {
      var code = pick(d || {}, 'invite_code', 'code', 'aff_code') || '';
      var link = Api.ORIGIN + '/register?aff=' + encodeURIComponent(code);
      host.appendChild(h('div', { class: 'card pad' },
        h('div', { class: 'tiny muted' }, '我的邀请码'),
        h('div', { style: { fontSize: '24px', fontWeight: '700', letterSpacing: '1px', margin: '4px 0 12px' } }, code || '—'),
        h('button', { class: 'btn btn-sm', onclick: function () { U.copy(link); } }, '复制邀请链接'),
        h('div', { class: 'divider' }),
        h('div', { class: 'grid-2' },
          h('div', { class: 'stat', style: { padding: '0' } },
            h('b', null, U.num(Number(pick(d, 'referred_count', 'invite_count', 'users') || 0))), h('span', null, '已邀请')),
          h('div', { class: 'stat', style: { padding: '0' } },
            h('b', null, U.credits(Number(pick(d, 'total_rebate', 'rebate', 'earnings', 'balance') || 0))), h('span', null, '返利 credits'))
        ),
        h('button', {
          class: 'btn btn-block', style: { marginTop: '14px' },
          onclick: function () {
            Api.affTransfer().then(function () { U.toast('已转入余额', 'ok'); App.refreshUser(); })
              .catch(function (e) { U.toast(e.message, 'err'); });
          }
        }, '返利转入余额')
      ));
    }).catch(function (e) {
      host.appendChild(emptyState('暂时无法获取邀请信息', e.message, 'users'));
    });
    return page;
  }

  function openInAppWeb() {
    if (global.Native && global.Native.openInApp) {
      U.toast('正在打开网页版…');
      global.Native.openInApp(Api.ORIGIN);
    } else {
      C.open(Api.ORIGIN);
    }
  }

  global.PagesUser = {
    renderKeys: renderKeys, renderUsage: renderUsage, renderMe: renderMe,
    renderRedeem: renderRedeem, renderPurchase: renderPurchase, renderAffiliate: renderAffiliate,
    needLogin: needLogin
  };
})(window);
