import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-schema-editor',
  templateUrl: './schema-editor.component.html'
})
export class SchemaEditorComponent {
  @Input() schema: any;
  @Output() cancel = new EventEmitter<void>();
  @Output() apply = new EventEmitter<{ removeKeys: string[]; addFields: Array<{ label: string; type: string; required?: boolean; options?: string[] }> }>();

  removalSet = new Set<string>();
  newFields: Array<{ label: string; type: string; required?: boolean; options?: string }> = [];

  types = ['text','email','number','date','datetime-local','time','month','week','textarea','select','radio','checkbox','password','tel','url','color','range'];

  toggleRemoval(key: string) {
    if (this.removalSet.has(key)) this.removalSet.delete(key); else this.removalSet.add(key);
  }

  addRow() { this.newFields.push({ label: '', type: 'text', required: false, options: '' }); }
  removeRow(i: number) { this.newFields.splice(i, 1); }

  onApply() {
    const removeKeys = Array.from(this.removalSet.values());
    const addFields = this.newFields
      .filter(f => (f.label || '').trim())
      .map(f => ({
        label: (f.label || '').trim(),
        type: (f.type || 'text').trim(),
        required: !!f.required,
        options: (f.options || '').split(',').map(x => x.trim()).filter(Boolean)
      }));
    this.apply.emit({ removeKeys, addFields });
  }
}

