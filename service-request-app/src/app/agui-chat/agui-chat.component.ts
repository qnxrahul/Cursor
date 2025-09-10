import { Component } from '@angular/core';
import { AguiService } from '../services/agui.service';

@Component({
  selector: 'app-agui-chat',
  templateUrl: './agui-chat.component.html'
})
export class AguiChatComponent {
  input = '';
  constructor(public agui: AguiService) {
    this.agui.start();
  }

  send() {
    const t = this.input.trim();
    if (!t) return;
    this.agui.send(t);
    this.input = '';
  }
}

