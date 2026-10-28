(() => {
  const root = document.documentElement;
  const THEME_KEY = 'homibook-theme';

  /* ---------- 主题切换 ---------- */

  const themeToggle = document.querySelector('.theme-toggle');
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = (theme) => {
    const isDark = theme === 'dark';
    root.dataset.theme = isDark ? 'dark' : 'light';
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', String(isDark));
      themeToggle.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
    }
  };

  applyTheme(root.dataset.theme || (media.matches ? 'dark' : 'light'));

  themeToggle?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* 隐私模式下忽略存储失败 */
    }
  });

  media.addEventListener('change', (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (e) {
      stored = null;
    }
    if (!stored) applyTheme(event.matches ? 'dark' : 'light');
  });

  /* ---------- 顶栏滚动状态 ---------- */

  const header = document.querySelector('.site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 移动端菜单 ---------- */

  const nav = document.getElementById('primary-nav');
  const menuToggle = document.querySelector('.menu-toggle');

  const closeMenu = () => {
    if (!nav?.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  nav?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('click', (event) => {
    if (!nav?.classList.contains('is-open')) return;
    if (nav.contains(event.target) || menuToggle?.contains(event.target)) return;
    closeMenu();
  });

  /* ---------- 截图灯箱（占位框点击放大） ---------- */

  const lightbox = document.getElementById('lightbox');
  const lightboxFrame = document.getElementById('lightbox-frame');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxClose = lightbox?.querySelector('.lightbox-close');
  let lastFocused = null;

  const closeLightbox = () => {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.style.overflow = '';
    lastFocused?.focus();
  };

  document.querySelectorAll('.shot').forEach((shot) => {
    const open = () => {
      if (!lightbox || !lightboxFrame) return;
      const image = shot.querySelector('img');

      if (image) {
        lightboxFrame.className = 'shot-frame shot-frame--image';
        lightboxFrame.replaceChildren(image.cloneNode(false));
      } else {
        const source = shot.querySelector('.shot-frame');
        const wide = source?.classList.contains('shot-frame--wide');
        lightboxFrame.className = `shot-frame ${wide ? 'shot-frame--wide' : 'shot-frame--phone'}`;
        lightboxFrame.innerHTML = '<span class="shot-title">截图待补充</span><span class="shot-note">替换 website/assets/screenshots/ 中的图片后显示</span>';
      }

      if (lightboxCaption) lightboxCaption.textContent = shot.dataset.title || '';
      lastFocused = document.activeElement;
      lightbox.hidden = false;
      document.body.style.overflow = 'hidden';
      lightboxClose?.focus();
    };

    shot.addEventListener('click', open);
    shot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });

  document.querySelectorAll('.shot').forEach((shot) => {
    if (!shot.hasAttribute('tabindex')) {
      shot.setAttribute('tabindex', '0');
      shot.setAttribute('role', 'button');
    }
  });

  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeLightbox();
      closeMenu();
    }
  });

  /* ---------- 页面预览切换 ---------- */

  const shotTabs = document.querySelector('.shot-tabs');

  if (shotTabs) {
    const tabs = Array.from(shotTabs.querySelectorAll('.shot-tab'));

    const activateTab = (tab) => {
      tabs.forEach((item) => {
        const selected = item === tab;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;

        const panel = document.getElementById(item.getAttribute('aria-controls'));
        if (!panel) return;
        panel.hidden = !selected;
        // 隐藏期间 IntersectionObserver 不会触发，切换后直接显示
        if (selected) {
          panel.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
        }
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab));
    });

    shotTabs.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;

      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;

      event.preventDefault();
      next.focus();
      activateTab(next);
    });
  }

  /* ---------- 代码复制 ---------- */

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  };

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.closest('.code-block')?.querySelector('code');
      if (!code) return;
      try {
        await copyText(code.textContent.trim());
        button.textContent = '已复制';
        button.classList.add('is-copied');
      } catch (e) {
        button.textContent = '复制失败';
      }
      window.setTimeout(() => {
        button.textContent = '复制';
        button.classList.remove('is-copied');
      }, 1800);
    });
  });

  /* ---------- 滚动渐显 ---------- */

  const revealItems = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px' }
    );
    revealItems.forEach((item) => observer.observe(item));
  }

  /* ---------- 年份 ---------- */

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
