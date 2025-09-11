import { Injectable } from '@angular/core';

export interface ThemeSettings {
  primary: string;
  accent: string;
  cardBg: string;
  text: string;
  radius: number; // px
  font: string;   // CSS font-family
}

const STORAGE_KEY = 'appThemeSettings.v1';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private defaults: ThemeSettings = {
    primary: '#0d6efd',
    accent: '#6f42c1',
    cardBg: '#ffffff',
    text: '#212529',
    radius: 8,
    font: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
  };

  load(): ThemeSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...this.defaults };
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
      return { ...this.defaults, ...parsed } as ThemeSettings;
    } catch {
      return { ...this.defaults };
    }
  }

  save(settings: ThemeSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  apply(settings: ThemeSettings): void {
    const r = document.documentElement;
    r.style.setProperty('--app-primary', settings.primary);
    r.style.setProperty('--app-accent', settings.accent);
    r.style.setProperty('--app-card-bg', settings.cardBg);
    r.style.setProperty('--app-text', settings.text);
    r.style.setProperty('--app-radius', `${settings.radius}px`);
    r.style.setProperty('--app-font', settings.font);
  }
}

