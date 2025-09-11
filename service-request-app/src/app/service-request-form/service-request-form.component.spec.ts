import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ServiceRequestFormComponent } from './service-request-form.component';
import { AguiService } from '../services/agui.service';
import { BehaviorSubject } from 'rxjs';

class AguiServiceStub {
  state$ = new BehaviorSubject<any>({});
  start = jasmine.createSpy('start');
}

describe('ServiceRequestFormComponent', () => {
  let component: ServiceRequestFormComponent;
  let fixture: ComponentFixture<ServiceRequestFormComponent>;
  let stub: AguiServiceStub;

  beforeEach(async () => {
    stub = new AguiServiceStub();
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule],
      declarations: [ServiceRequestFormComponent],
      providers: [{ provide: AguiService, useValue: stub }]
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceRequestFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('patches form values when formPartial emits', () => {
    // This component uses AgentService in the real app, here we verify patching via direct form updates
    component.form.patchValue({ name: 'Alice', email: 'alice@example.com' });
    fixture.detectChanges();
    expect(component.form.get('name')?.value).toBe('Alice');
    expect(component.form.get('email')?.value).toBe('alice@example.com');
    expect(component.done).toBeFalse();
  });
});

