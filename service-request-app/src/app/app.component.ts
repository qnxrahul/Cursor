import { Component, OnInit } from '@angular/core';
import { ThemeService } from './services/theme.service';
import { AguiService } from './services/agui.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'service-request-app';
  constructor(private theme: ThemeService, public agui: AguiService) {}
  ngOnInit(): void {
    const settings = this.theme.load();
    this.theme.apply(settings);
  }
}
