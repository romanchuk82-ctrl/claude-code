# SKATE specialist model sources

## Fall detection
- Source: https://github.com/punpayut/Fall-Detection
- Artifact: `fall_detection_transformer.tflite`
- Architecture: pose-sequence Transformer, 30 frames x 17 keypoints x (x,y,confidence)
- Reported result by upstream project: 94.9% F1, 94.1% fall recall
- License: MIT. Full upstream license is stored alongside the model.

The model was not trained specifically on figure-skating falls. SKATE treats its output as one signal in a skating-specific fall decision, together with post-landing pose geometry and motion.
