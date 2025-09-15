import { Component } from '@angular/core';
import { ThemeService, ThemeSettings } from '../services/theme.service';

@Component({
  selector: 'app-theme-customizer',
  templateUrl: './theme-customizer.component.html'
})
export class ThemeCustomizerComponent {
  settings: ThemeSettings;

  constructor(private theme: ThemeService) {
    this.settings = this.theme.load();
    this.theme.apply(this.settings);
  }

  update<K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) {
    this.settings = { ...this.settings, [key]: value } as ThemeSettings;
    this.theme.apply(this.settings);
    this.theme.save(this.settings);
  }
}

