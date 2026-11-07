/* Myon · 后台弹窗的统一关闭守卫
   - 点弹窗外的空白 / 按 Esc 时：表单没改过 → 直接关；改过 → 弹页面内确认框。
   - 关闭按钮、保存成功等显式 .close() 调用不受影响。
   - 动态创建的 dialog（媒体选择器）也会通过 MutationObserver 自动接管。
   - 想跳过守卫的 dialog 加 data-dismiss-guard="off"（本脚本自己的确认框就用它）。 */
(function () {
  'use strict';

  var confirmDialog = null;
  var pendingDialog = null;
  var observed = false;
  var CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="file"]):not([type="search"])',
    'textarea',
    'select',
    '[data-dirty-track]',
  ].join(',');
  var IGNORE_SELECTOR = '[data-dirty-ignore]';

  function closeNative(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function controlsOf(dialog) {
    return Array.prototype.filter.call(
      dialog.querySelectorAll(CONTROL_SELECTOR),
      function (control) {
        return !control.closest(IGNORE_SELECTOR) && !control.disabled;
      },
    );
  }

  function snapshot(dialog) {
    dialog.__snapshot = controlsOf(dialog).map(function (control) {
      return control.type === 'checkbox' || control.type === 'radio'
        ? control.checked
        : control.value;
    });
    dialog.__snapshotReady = true;
  }

  function isDirty(dialog) {
    if (!dialog.__snapshotReady) return false;
    var controls = controlsOf(dialog);
    var values = dialog.__snapshot || [];
    if (controls.length !== values.length) return true;
    for (var i = 0; i < controls.length; i += 1) {
      var control = controls[i];
      var current =
        control.type === 'checkbox' || control.type === 'radio'
          ? control.checked
          : control.value;
      if (current !== values[i]) return true;
    }
    return false;
  }

  function buildConfirm() {
    if (confirmDialog) return confirmDialog;
    var dialog = document.createElement('dialog');
    dialog.className = 'dlg';
    dialog.id = 'adminDiscardDlg';
    dialog.setAttribute('aria-labelledby', 'adminDiscardTitle');
    dialog.setAttribute('data-dismiss-guard', 'off');
    dialog.innerHTML =
      '<div class="dlg-box">' +
      '<span class="dlg-tab">CONFIRM / 未保存</span>' +
      '<div class="dlg-h"><span id="adminDiscardTitle">放弃修改？</span><span>UNSAVED</span></div>' +
      '<p class="dlg-c" id="adminDiscardText">当前弹窗里有未保存的修改，关闭后这些内容会丢失。</p>' +
      '<div class="dlg-f"><span class="dlg-c">只关闭当前弹窗，不影响页面其它内容</span>' +
      '<div class="dlg-a">' +
      '<button class="p-btn" id="adminDiscardStay" type="button">继续编辑</button>' +
      '<button class="p-btn p-btn--pub" id="adminDiscardLeave" type="button">放弃修改</button>' +
      '</div></div></div>';
    document.body.appendChild(dialog);
    dialog
      .querySelector('#adminDiscardStay')
      .addEventListener('click', function () {
        closeNative(confirmDialog);
        if (pendingDialog) pendingDialog.focus();
      });
    dialog
      .querySelector('#adminDiscardLeave')
      .addEventListener('click', function () {
        var target = pendingDialog;
        pendingDialog = null;
        closeNative(confirmDialog);
        closeNative(target);
      });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closeNative(confirmDialog);
    });
    confirmDialog = dialog;
    return dialog;
  }

  function askDiscard(dialog) {
    pendingDialog = dialog;
    var prompt = buildConfirm();
    var text = prompt.querySelector('#adminDiscardText');
    if (text) {
      var title = dialog.getAttribute('aria-labelledby');
      var titleNode = title ? document.getElementById(title) : null;
      text.textContent =
        '「' +
        ((titleNode && titleNode.textContent) || '当前弹窗') +
        '」里有未保存的修改，关闭后这些内容会丢失。';
    }
    if (typeof prompt.showModal === 'function') {
      if (!prompt.open) prompt.showModal();
    } else {
      prompt.setAttribute('open', '');
    }
  }

  function requestClose(dialog) {
    if (!dialog || !dialog.open || dialog.__closing) return;
    if (isDirty(dialog)) {
      askDiscard(dialog);
      return;
    }
    dialog.__closing = true;
    try {
      closeNative(dialog);
    } finally {
      dialog.__closing = false;
    }
  }

  function onToggle(dialog) {
    if (dialog.open) {
      // showModal() 补丁通常已经同步拍过快照；toggle 只做兜底。
      if (!dialog.__snapshotReady && controlsOf(dialog).length >= 0) {
        snapshot(dialog);
      }
    } else {
      dialog.__snapshot = null;
      dialog.__snapshotReady = false;
    }
  }

  /** 在 showModal 打开时同步记录初始值，避免用户刚打开就输入导致快照被污染。 */
  function patchShowModal() {
    if (typeof HTMLDialogElement === 'undefined') return;
    var original = HTMLDialogElement.prototype.showModal;
    if (typeof original !== 'function' || original.__myonPatched) return;
    var patched = function () {
      var result = original.apply(this, arguments);
      if (this.getAttribute('data-dismiss-guard') === 'off') return result;
      attach(this);
      this.__snapshotReady = false;
      this.__snapshot = null;
      snapshot(this);
      return result;
    };
    patched.__myonPatched = true;
    HTMLDialogElement.prototype.showModal = patched;
  }

  function attach(dialog) {
    if (!dialog || dialog.tagName !== 'DIALOG') return;
    if (dialog.getAttribute('data-dismiss-guard') === 'off') return;
    if (dialog.__dismissGuardAttached) return;
    dialog.__dismissGuardAttached = true;

    dialog.addEventListener('toggle', function () {
      onToggle(dialog);
    });
    if (dialog.open) onToggle(dialog);

    dialog.addEventListener('cancel', function (event) {
      // 页面自己已经处理了 Esc（例如提交中禁止关闭）时不重复拦截。
      if (event.defaultPrevented) return;
      event.preventDefault();
      requestClose(dialog);
    });

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) requestClose(dialog);
    });
  }

  function attachAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.tagName === 'DIALOG') attach(scope);
    Array.prototype.forEach.call(
      scope.querySelectorAll('dialog'),
      function (dialog) {
        attach(dialog);
      },
    );
  }

  function init() {
    patchShowModal();
    attachAll(document);
    if (!observed && window.MutationObserver) {
      observed = true;
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(
            mutation.addedNodes,
            function (node) {
              if (node.nodeType !== 1) return;
              attachAll(node);
              if (node.parentNode) attachAll(node.parentNode);
            },
          );
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MyonAdminDialog = { attach: attachAll, isDirty: isDirty };
})();
