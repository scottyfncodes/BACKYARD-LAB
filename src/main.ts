import './styles.css';
import { initPhysics } from './sim/physics';
import { Game } from './game/game';

async function boot() {
  const loading = document.getElementById('loading')!;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  try {
    await initPhysics();
    const game = new Game(canvas, ui);
    (window as unknown as { game: Game }).game = game;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 600);
  } catch (e) {
    console.error(e);
    loading.querySelector('.msg')!.textContent = 'Something broke while loading. Try reloading?';
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

void boot();
