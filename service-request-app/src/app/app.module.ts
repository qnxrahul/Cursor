import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ServiceRequestFormComponent } from './service-request-form/service-request-form.component';
import { ChatComponent } from './chat/chat.component';
import { AguiChatComponent } from './agui-chat/agui-chat.component';
import { ThemeCustomizerComponent } from './theme-customizer/theme-customizer.component';
import { SchemaEditorComponent } from './schema-editor/schema-editor.component';

@NgModule({
  declarations: [
    AppComponent,
    ServiceRequestFormComponent,
    ChatComponent,
    AguiChatComponent,
    ThemeCustomizerComponent,
    SchemaEditorComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    ReactiveFormsModule,
    FormsModule,
    HttpClientModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
