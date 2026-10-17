'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 公告版本号——以后想再弹新公告，改这里就行（旧版 key 失效，新版重新弹一次）
const ANNOUNCEMENT_VERSION = '2026-10-17b';
const STORAGE_KEY = `announcement_seen_${ANNOUNCEMENT_VERSION}`;

export default function AnnouncementModal() {
  // 默认不开，client 端 useEffect 检查 localStorage 后立即决定是否弹出。
  // 没看过 → 立即覆盖首页；看过 → 不再弹。
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false); // hydration 完成标志

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setOpen(true);
    } catch { /* localStorage 可能被禁，忽略 */ }
    setDecided(true);
  }, []);

  // 公告打开时锁住 body 滚动，防止背后首页可滚（仪式感更强）
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* skip */ }
  };

  if (!decided) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          // 不点击外部关闭——强制用户按"我知道了"按钮才能进入首页
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(20,12,2,0.88)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'linear-gradient(180deg, #fefcf6 0%, #faf3e3 100%)',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '640px',
              maxHeight: 'min(85vh, 760px)',
              overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(60,30,10,0.4), 0 4px 16px rgba(60,30,10,0.2)',
              border: '1px solid rgba(184,146,42,0.25)',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            {/* 顶部装饰 + 关闭按钮 */}
            <div style={{
              padding: '22px 28px 14px',
              borderBottom: '1px solid rgba(184,146,42,0.15)',
              background: 'linear-gradient(180deg, rgba(184,146,42,0.08) 0%, transparent 100%)',
              flexShrink: 0,
              position: 'relative',
            }}>
              <div style={{ fontSize: '10px', letterSpacing: '0.4em', color: '#b8922a', opacity: 0.7, marginBottom: '6px' }}>
                ABOUT ZIWEI DOUSHU
              </div>
              <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#3d2f10', letterSpacing: '0.08em', margin: 0 }}>
                关于紫微斗数
              </h2>
              <button
                onClick={close}
                aria-label="关闭"
                style={{
                  position: 'absolute', top: '14px', right: '16px',
                  width: '28px', height: '28px',
                  background: 'rgba(184,146,42,0.08)',
                  border: '1px solid rgba(184,146,42,0.2)',
                  borderRadius: '50%',
                  color: '#7a5e2a', fontSize: '14px',
                  cursor: 'pointer', lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>

            {/* 正文（可滚动）*/}
            <div style={{
              padding: '18px 28px 24px',
              overflowY: 'auto',
              fontSize: '14px',
              lineHeight: 1.85,
              color: '#5a4a30',
              flex: 1,
            }}>
              <p style={{ margin: '0 0 12px' }}>
                <strong style={{ color: '#3d2f10' }}>紫微斗数是什么？</strong>它是中国传统命理术数之一，以人的出生时间排布十二宫与诸星曜，形成一张命盘，再由星曜组合推演人生各阶段的形态。它与八字、六爻等同属古代术数体系。
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong style={{ color: '#3d2f10' }}>起源与过去的作用。</strong>紫微斗数相传始于宋代陈抟（希夷先生），明清时期逐步成熟并形成完整体系。古人借助它观察人生的节律与处境，把它当作一种自我认知和辅助判断的框架，而非精确预知未来的工具。
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong style={{ color: '#3d2f10' }}>今天怎么看。</strong>现代社会把它视作传统文化与民俗的一部分，可以了解、可以研究，但我们不传播、不鼓励迷信。人的选择与努力始终比任何命盘更重要，请勿据此做重大决定。
              </p>
              <p style={{
                margin: '0 0 16px',
                padding: '12px 14px',
                background: 'rgba(184,146,42,0.07)',
                borderLeft: '3px solid rgba(184,146,42,0.45)',
                borderRadius: '0 8px 8px 0',
                color: '#7a5e2a',
              }}>
                <strong style={{ color: '#3d2f10' }}>免责声明：</strong>本项目源自<strong style={{ color: '#3d2f10' }}>紫微斗数开源样本数据集 v3.0</strong>，是来自开源社区的测试运行版本，功能与数据均可能随时变更、中断或出错，不作任何可用性保证。站内所有内容仅供传统文化学习与娱乐参考，不构成医疗、法律、财务或任何其他专业建议，亦不构成对未来的预测。使用本平台所产生的一切后果由使用者自行承担。
              </p>
            </div>

            {/* 底部按钮 */}
            <div style={{
              padding: '14px 22px',
              borderTop: '1px solid rgba(184,146,42,0.15)',
              background: 'rgba(184,146,42,0.04)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              flexShrink: 0,
            }}>
              <button
                onClick={close}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #b8922a 0%, #9a7a20 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '13px',
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(184,146,42,0.3)',
                }}
              >
                我知道了
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
