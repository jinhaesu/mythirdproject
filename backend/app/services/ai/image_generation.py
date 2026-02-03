"""Image generation service using Replicate/Stable Diffusion."""
from typing import Dict, Any, Optional, List
import replicate
import httpx

from app.core.config import get_settings

settings = get_settings()


class ImageGenerationService:
    """Service for AI image generation."""

    def __init__(self):
        self.replicate_client = replicate.Client(api_token=settings.REPLICATE_API_TOKEN)

    def _get_dimensions(self, format: str) -> tuple:
        """Get dimensions for format."""
        dimensions = {
            "1:1": (1024, 1024),
            "4:5": (1024, 1280),
            "9:16": (1024, 1820),
            "16:9": (1820, 1024),
        }
        return dimensions.get(format, (1024, 1024))

    async def generate_image(
        self,
        prompt: str,
        format: str = "1:1",
        style: Optional[str] = None,
        negative_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate image using Stable Diffusion XL.

        Returns URL of generated image.
        """
        width, height = self._get_dimensions(format)

        # Enhance prompt with style
        full_prompt = prompt
        if style:
            full_prompt = f"{prompt}, {style} style, professional advertisement, high quality"

        default_negative = "low quality, blurry, distorted, watermark, text errors, ugly"
        negative = negative_prompt or default_negative

        try:
            output = self.replicate_client.run(
                "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
                input={
                    "prompt": full_prompt,
                    "negative_prompt": negative,
                    "width": width,
                    "height": height,
                    "num_outputs": 1,
                    "scheduler": "K_EULER",
                    "num_inference_steps": 30,
                    "guidance_scale": 7.5,
                }
            )

            if output and len(output) > 0:
                return {
                    "success": True,
                    "image_url": output[0],
                    "prompt_used": full_prompt
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

        return {"success": False, "error": "No output generated"}

    async def generate_variations(
        self,
        prompt: str,
        format: str = "1:1",
        count: int = 4,
        style: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Generate multiple image variations.
        """
        width, height = self._get_dimensions(format)

        full_prompt = prompt
        if style:
            full_prompt = f"{prompt}, {style} style, professional advertisement, high quality"

        try:
            output = self.replicate_client.run(
                "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
                input={
                    "prompt": full_prompt,
                    "negative_prompt": "low quality, blurry, distorted, watermark, ugly",
                    "width": width,
                    "height": height,
                    "num_outputs": min(count, 4),
                    "scheduler": "K_EULER",
                    "num_inference_steps": 30,
                    "guidance_scale": 7.5,
                }
            )

            results = []
            for i, url in enumerate(output):
                results.append({
                    "variation_index": i,
                    "image_url": url,
                    "prompt_used": full_prompt
                })
            return results

        except Exception as e:
            return [{"success": False, "error": str(e)}]

    async def outpaint_image(
        self,
        image_url: str,
        target_format: str,
        direction: str = "vertical"
    ) -> Dict[str, Any]:
        """
        Extend image background using outpainting.

        Useful for converting 1:1 to 9:16 (story format).
        """
        width, height = self._get_dimensions(target_format)

        try:
            output = self.replicate_client.run(
                "stability-ai/stable-diffusion-x4-upscaler:40a4abf3231e42e04a8d4b9ba1aa3c3e4ec7a5b8aa2e889d29d2a39d0c7e9c8a",
                input={
                    "image": image_url,
                    "scale": 2,
                    "face_enhance": False,
                }
            )

            if output:
                return {
                    "success": True,
                    "image_url": output,
                    "original_url": image_url,
                    "new_format": target_format
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

        return {"success": False, "error": "Outpainting failed"}

    async def add_text_to_image(
        self,
        image_url: str,
        text: str,
        position: str = "center",
        font_style: str = "modern"
    ) -> Dict[str, Any]:
        """
        Add text overlay to image using AI.

        Note: This uses image-to-image with text instruction.
        """
        position_prompts = {
            "top": "text at the top of the image",
            "center": "text in the center of the image",
            "bottom": "text at the bottom of the image"
        }

        prompt = f"""
        Add the following text to the image: "{text}"
        Position: {position_prompts.get(position, 'center')}
        Style: {font_style}, clean, readable, professional advertisement
        Keep the original image content, only add text overlay
        """

        try:
            output = self.replicate_client.run(
                "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
                input={
                    "prompt": prompt,
                    "image": image_url,
                    "prompt_strength": 0.3,  # Keep most of original
                    "num_outputs": 1,
                }
            )

            if output and len(output) > 0:
                return {
                    "success": True,
                    "image_url": output[0],
                    "text_added": text
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

        return {"success": False, "error": "Text addition failed"}


class VideoGenerationService:
    """Service for AI video generation."""

    def __init__(self):
        self.replicate_client = replicate.Client(api_token=settings.REPLICATE_API_TOKEN)

    async def generate_video(
        self,
        prompt: str,
        duration_seconds: int = 15,
        aspect_ratio: str = "9:16"
    ) -> Dict[str, Any]:
        """
        Generate short video using AI.

        Uses Runway Gen-2 style model via Replicate.
        """
        try:
            # Using a video generation model
            output = self.replicate_client.run(
                "anotherjesse/zeroscope-v2-xl:9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351",
                input={
                    "prompt": prompt,
                    "num_frames": min(duration_seconds * 8, 120),  # ~8 fps
                    "width": 576 if aspect_ratio == "9:16" else 1024,
                    "height": 1024 if aspect_ratio == "9:16" else 576,
                    "num_inference_steps": 50,
                    "guidance_scale": 17.5,
                }
            )

            if output:
                return {
                    "success": True,
                    "video_url": output,
                    "duration": duration_seconds,
                    "prompt_used": prompt
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

        return {"success": False, "error": "Video generation failed"}

    async def add_voice_to_video(
        self,
        video_url: str,
        script: str,
        voice_style: str = "calm"
    ) -> Dict[str, Any]:
        """
        Add AI voice narration to video.
        """
        # Voice style mapping
        voice_map = {
            "calm": "alloy",
            "energetic": "nova",
            "male": "onyx",
            "female": "shimmer"
        }

        try:
            # First generate audio using OpenAI TTS
            from openai import OpenAI
            openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)

            audio_response = openai_client.audio.speech.create(
                model="tts-1",
                voice=voice_map.get(voice_style, "alloy"),
                input=script
            )

            # Save audio temporarily (in production, upload to cloud storage)
            audio_url = "generated_audio.mp3"
            audio_response.stream_to_file(audio_url)

            return {
                "success": True,
                "audio_url": audio_url,
                "video_url": video_url,
                "voice_style": voice_style,
                "note": "Audio generated. Video+Audio merge requires ffmpeg processing."
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def add_subtitles(
        self,
        video_url: str,
        transcript: str,
        style: str = "reels"
    ) -> Dict[str, Any]:
        """
        Add auto-generated subtitles to video.

        Note: Full implementation requires video processing (ffmpeg).
        """
        return {
            "success": True,
            "video_url": video_url,
            "transcript": transcript,
            "subtitle_style": style,
            "note": "Subtitle data prepared. Video processing required for final output."
        }
