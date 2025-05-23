import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { createSphereShader, createBackdropShader } from "@/lib/shaders";

interface ThreeSceneProps {
  inputAnalyzer: AudioAnalyzer | null;
  outputAnalyzer: AudioAnalyzer | null;
  isActive: boolean;
}

export function ThreeScene({ inputAnalyzer, outputAnalyzer, isActive }: ThreeSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    sphere: THREE.Mesh;
    backdrop: THREE.Mesh;
    animationId: number;
  } | null>(null);
  
  const timeRef = useRef(0);
  const rotationRef = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0A0E1A);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(2, -2, 5);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    // Create backdrop
    const backdropGeometry = new THREE.IcosahedronGeometry(10, 5);
    const backdropMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        rand: { value: 0 }
      },
      vertexShader: createBackdropShader().vertexShader,
      fragmentShader: createBackdropShader().fragmentShader,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide
    });
    
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    scene.add(backdrop);

    // Create main sphere
    const sphereGeometry = new THREE.IcosahedronGeometry(1, 10);
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x4285F4,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0x001122,
      emissiveIntensity: 0.5
    });

    // Add custom shader to sphere material
    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.inputData = { value: new THREE.Vector4() };
      shader.uniforms.outputData = { value: new THREE.Vector4() };

      (sphereMaterial as any).userData.shader = shader;
      shader.vertexShader = createSphereShader();
    };

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x4285F4, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      sphere,
      backdrop,
      animationId: 0
    };

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      
      const backdropUniforms = (backdrop.material as THREE.RawShaderMaterial).uniforms;
      backdropUniforms.resolution.value.set(
        window.innerWidth * renderer.getPixelRatio(),
        window.innerHeight * renderer.getPixelRatio()
      );
    };

    window.addEventListener('resize', handleResize);

    // Start animation loop
    animate();

    function animate() {
      if (!sceneRef.current) return;

      const { scene, camera, renderer, sphere, backdrop } = sceneRef.current;
      
      // Update time
      timeRef.current += 0.016; // ~60fps
      
      // Update backdrop
      const backdropUniforms = (backdrop.material as THREE.RawShaderMaterial).uniforms;
      backdropUniforms.rand.value = Math.random() * 10000;

      // Get audio data
      let inputLevel = 0;
      let outputLevel = 0;
      
      if (inputAnalyzer && isActive) {
        inputAnalyzer.update();
        inputLevel = inputAnalyzer.getAverageFrequency() / 255;
      }
      
      if (outputAnalyzer && isActive) {
        outputAnalyzer.update();
        outputLevel = outputAnalyzer.getAverageFrequency() / 255;
      }

      // Update sphere with audio data
      const sphereMaterial = sphere.material as THREE.MeshStandardMaterial;
      if ((sphereMaterial as any).userData.shader) {
        const shader = (sphereMaterial as any).userData.shader;
        
        // Scale sphere based on audio
        sphere.scale.setScalar(1 + (0.2 * outputLevel));
        
        // Rotate based on audio
        const dt = 0.016;
        const f = 0.001;
        rotationRef.current.x += dt * f * 0.5 * outputLevel;
        rotationRef.current.z += dt * f * 0.5 * inputLevel;
        rotationRef.current.y += dt * f * 0.25 * (inputLevel + outputLevel);

        // Update camera position
        const euler = new THREE.Euler(
          rotationRef.current.x,
          rotationRef.current.y,
          rotationRef.current.z
        );
        const quaternion = new THREE.Quaternion().setFromEuler(euler);
        const vector = new THREE.Vector3(0, 0, 5);
        vector.applyQuaternion(quaternion);
        camera.position.copy(vector);
        camera.lookAt(sphere.position);

        // Update shader uniforms
        shader.uniforms.time.value += dt * 0.1 * outputLevel;
        shader.uniforms.inputData.value.set(
          inputLevel,
          0.1 * inputLevel,
          10 * inputLevel,
          0
        );
        shader.uniforms.outputData.value.set(
          2 * outputLevel,
          0.1 * outputLevel,
          10 * outputLevel,
          0
        );
      } else {
        // Fallback animation when no audio
        sphere.rotation.x += 0.005;
        sphere.rotation.y += 0.01;
        backdrop.rotation.x -= 0.001;
        backdrop.rotation.y -= 0.002;
      }

      renderer.render(scene, camera);
      sceneRef.current.animationId = requestAnimationFrame(animate);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        sceneRef.current.renderer.dispose();
        sceneRef.current.scene.clear();
      }
      
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [inputAnalyzer, outputAnalyzer, isActive]);

  return (
    <div 
      ref={mountRef} 
      className="absolute inset-0 w-full h-full"
      style={{
        background: "radial-gradient(circle at center, #1A1F2E 0%, #0A0E1A 100%)"
      }}
    />
  );
}
