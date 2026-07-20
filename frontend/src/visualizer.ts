export type VisualizerMode = "frequency-bars" | "circular-wave";

export class AudioVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode;
  private animationId: number | null = null;
  private particles: Array<{ x: number; y: number; r: number; s: number; alpha: number }> = [];
  private dataArray: Uint8Array;
  private resizeHandler: () => void;
  private mode: VisualizerMode = "frequency-bars";

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get 2D canvas context");
    }
    this.ctx = context;
    this.analyser = analyser;
    
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Initialize ambient background particles
    this.initParticles();

    // Bind and add resize listener
    this.resizeHandler = () => this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.resize();
  }

  public setMode(mode: VisualizerMode): void {
    this.mode = mode;
  }

  public start(): void {
    if (this.animationId !== null) return;
    this.render();
  }

  public stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener("resize", this.resizeHandler);
  }

  private resize(): void {
    this.canvas.width = this.canvas.clientWidth || window.innerWidth;
    this.canvas.height = this.canvas.clientHeight || window.innerHeight;
  }

  private initParticles(): void {
    this.particles = [];
    const count = 50;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * (this.canvas.width || window.innerWidth),
        y: Math.random() * (this.canvas.height || window.innerHeight),
        r: Math.random() * 3 + 1,
        s: Math.random() * 1.2 + 0.3,
        alpha: Math.random() * 0.4 + 0.1
      });
    }
  }

  private render(): void {
    this.animationId = requestAnimationFrame(() => this.render());
    this.draw();
  }

  private draw(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.analyser.getByteFrequencyData(this.dataArray as any);

    // Clear with semi-transparent black for motion trail
    this.ctx.fillStyle = "rgba(7, 8, 11, 0.15)";
    this.ctx.fillRect(0, 0, width, height);

    // Calculate overall energy/bass intensity
    let bassAvg = 0;
    const bassSection = 10; // First 10 bins represent low/bass frequencies
    for (let i = 0; i < bassSection; i++) {
      bassAvg += this.dataArray[i] || 0;
    }
    bassAvg /= bassSection;
    const intensity = bassAvg / 255;
    const pulseScale = 1.0 + intensity * 0.2;

    // Render background ambient radial glow
    const glowGrad = this.ctx.createRadialGradient(
      width / 2, height / 2, 50,
      width / 2, height / 2, Math.max(width, height) / 2 * pulseScale
    );
    glowGrad.addColorStop(0, "rgba(255, 98, 71, 0.05)");
    glowGrad.addColorStop(0.5, "rgba(7, 8, 11, 0.1)");
    glowGrad.addColorStop(1, "rgba(7, 8, 11, 0.9)");
    this.ctx.fillStyle = glowGrad;
    this.ctx.fillRect(0, 0, width, height);

    // Render floating particles
    this.particles.forEach((p) => {
      // Speed up particles with bass energy
      p.y -= p.s * (1.0 + intensity * 5);
      if (p.y < -10) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r * pulseScale, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 98, 71, ${p.alpha})`;
      this.ctx.fill();
    });

    if (this.mode === "frequency-bars") {
      this.drawBars(width, height, intensity);
    } else {
      this.drawCircularWave(width, height, pulseScale);
    }
  }

  private drawBars(width: number, height: number, intensity: number): void {
    const totalBars = this.dataArray.length;
    const barWidth = (width / totalBars) * 1.5;
    let x = 0;

    for (let i = 0; i < totalBars; i++) {
      const value = this.dataArray[i] ?? 0;
      const percent = value / 255;
      const barHeight = percent * height * 0.6;

      // Color gradient transitioning from deep orange (accent) to glowing hot white-orange
      const grad = this.ctx.createLinearGradient(0, height, 0, height - barHeight);
      grad.addColorStop(0, "rgba(255, 98, 71, 0.1)");
      grad.addColorStop(0.5, "rgba(255, 98, 71, 0.7)");
      grad.addColorStop(1, "rgba(255, 235, 230, 0.95)");

      this.ctx.fillStyle = grad;
      // Draw smooth rounded corner bars
      this.ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);

      // Top glowing dot
      this.ctx.fillStyle = "rgba(255, 235, 230, 0.8)";
      this.ctx.fillRect(x, height - barHeight - 4, barWidth - 2, 2);

      x += barWidth;
    }
  }

  private drawCircularWave(width: number, height: number, pulseScale: number): void {
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = Math.min(width, height) * 0.15;
    const activeRadius = baseRadius * pulseScale;

    // Draw central spinning/pulsing vinyl ring
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, activeRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = "rgba(255, 98, 71, 0.3)";
    this.ctx.lineWidth = 4;
    this.ctx.stroke();

    const pointsCount = 180;
    const angleStep = (Math.PI * 2) / pointsCount;

    // Draw radiating circular frequency ring
    this.ctx.beginPath();
    for (let i = 0; i < pointsCount; i++) {
      const angle = i * angleStep;
      // Mirror the frequencies around the circle
      const dataIndex = Math.floor(Math.abs(Math.sin(angle)) * (this.dataArray.length - 1));
      const value = this.dataArray[dataIndex] || 0;
      const magnitude = (value / 255) * baseRadius * 0.7;

      const r = activeRadius + magnitude;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
    this.ctx.strokeStyle = "rgba(255, 98, 71, 0.8)";
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // Fill inner glow
    this.ctx.fillStyle = "rgba(255, 98, 71, 0.05)";
    this.ctx.fill();
  }
}
