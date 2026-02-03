'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image, Video, Wand2, Type, Expand, Check, Loader2 } from 'lucide-react';
import { Button, Input, Card, CardTitle, Select } from '@/components/ui';
import { creativeApi } from '@/lib/api';
import { useAppStore } from '@/store';
import type { Creative, GenerationJob } from '@/types';
import toast from 'react-hot-toast';

export function CreativeStudio() {
  const { selectedStyle, stylePrompt, addSelectedCreative, selectedCreatives } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [highlightText, setHighlightText] = useState('');
  const [format, setFormat] = useState<'1:1' | '4:5' | '9:16'>('1:1');
  const [variations, setVariations] = useState(4);
  const [currentJob, setCurrentJob] = useState<string | null>(null);
  const [generatedCreatives, setGeneratedCreatives] = useState<Creative[]>([]);

  // Video settings
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoScript, setVideoScript] = useState('');
  const [voiceStyle, setVoiceStyle] = useState<'calm' | 'energetic' | 'male' | 'female'>('calm');
  const [includeSubtitles, setIncludeSubtitles] = useState(true);

  // Library
  const { data: library, refetch: refetchLibrary } = useQuery({
    queryKey: ['creative-library'],
    queryFn: () => creativeApi.getLibrary(),
  });

  // Use style from Market Intelligence
  useEffect(() => {
    if (stylePrompt) {
      setPrompt(stylePrompt);
    }
  }, [stylePrompt]);

  // Poll job status
  const { data: jobStatus } = useQuery({
    queryKey: ['job-status', currentJob],
    queryFn: () => creativeApi.getJobStatus(currentJob!),
    enabled: !!currentJob,
    refetchInterval: (data) => {
      if (data?.state?.data?.status === 'completed' || data?.state?.data?.status === 'failed') {
        return false;
      }
      return 2000;
    },
  });

  useEffect(() => {
    if (jobStatus?.status === 'completed' && jobStatus.results) {
      setGeneratedCreatives(jobStatus.results);
      setCurrentJob(null);
      refetchLibrary();
      toast.success('이미지 생성 완료!');
    } else if (jobStatus?.status === 'failed') {
      setCurrentJob(null);
      toast.error(jobStatus.error_message || '생성 실패');
    }
  }, [jobStatus]);

  const generateImageMutation = useMutation({
    mutationFn: () => creativeApi.generateImages({
      prompt: prompt || undefined,
      style_reference: selectedStyle ? JSON.stringify(selectedStyle) : undefined,
      highlight_text: highlightText || undefined,
      format,
      variations,
    }),
    onSuccess: (data) => {
      setCurrentJob(data.job_id);
      toast.success('이미지 생성을 시작합니다...');
    },
    onError: () => toast.error('이미지 생성 요청 실패'),
  });

  const generateVideoMutation = useMutation({
    mutationFn: () => creativeApi.generateVideo({
      prompt: videoPrompt || undefined,
      style_reference: selectedStyle ? JSON.stringify(selectedStyle) : undefined,
      script: videoScript || undefined,
      voice_style: voiceStyle,
      include_subtitles: includeSubtitles,
      duration_seconds: 15,
    }),
    onSuccess: (data) => {
      setCurrentJob(data.job_id);
      toast.success('영상 생성을 시작합니다...');
    },
    onError: () => toast.error('영상 생성 요청 실패'),
  });

  const extendBackgroundMutation = useMutation({
    mutationFn: ({ id, targetFormat }: { id: number; targetFormat: string }) =>
      creativeApi.extendBackground(id, targetFormat),
    onSuccess: (data) => {
      setGeneratedCreatives((prev) => [...prev, data]);
      refetchLibrary();
      toast.success('배경 확장 완료!');
    },
    onError: () => toast.error('배경 확장 실패'),
  });

  const isProcessing = !!currentJob || generateImageMutation.isPending || generateVideoMutation.isPending;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* 설정 패널 */}
      <div className="lg:col-span-1 space-y-6">
        {/* 이미지 생성 */}
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Image size={20} />
            이미지 생성
          </CardTitle>

          {selectedStyle && (
            <div className="mb-4 p-3 bg-primary-50 rounded-lg text-sm">
              <p className="font-medium text-primary-800">참조 스타일 적용됨</p>
              <p className="text-primary-600">{selectedStyle.visual_style} • {selectedStyle.appeal_type}</p>
            </div>
          )}

          <div className="space-y-4">
            <Input
              label="프롬프트 (선택)"
              placeholder="원하는 이미지 설명..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            <Input
              label="강조 텍스트"
              placeholder="프로모션 내용, 할인율 등"
              value={highlightText}
              onChange={(e) => setHighlightText(e.target.value)}
            />

            <Select
              label="포맷"
              options={[
                { value: '1:1', label: '1:1 (피드)' },
                { value: '4:5', label: '4:5 (피드 최적화)' },
                { value: '9:16', label: '9:16 (스토리/릴스)' },
              ]}
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
            />

            <Select
              label="시안 개수"
              options={[
                { value: '2', label: '2개' },
                { value: '4', label: '4개' },
                { value: '6', label: '6개' },
              ]}
              value={String(variations)}
              onChange={(e) => setVariations(Number(e.target.value))}
            />

            <Button
              className="w-full"
              onClick={() => generateImageMutation.mutate()}
              loading={isProcessing}
            >
              <Wand2 size={16} className="mr-2" />
              이미지 생성
            </Button>
          </div>
        </Card>

        {/* 영상 생성 */}
        <Card variant="bordered">
          <CardTitle className="flex items-center gap-2 mb-4">
            <Video size={20} />
            쇼츠 생성
          </CardTitle>

          <div className="space-y-4">
            <Input
              label="프롬프트"
              placeholder="원하는 영상 설명..."
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">스크립트 (나레이션)</label>
              <textarea
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                rows={3}
                placeholder="영상에 들어갈 나레이션 스크립트..."
                value={videoScript}
                onChange={(e) => setVideoScript(e.target.value)}
              />
            </div>

            <Select
              label="AI 보이스"
              options={[
                { value: 'calm', label: '차분한 톤' },
                { value: 'energetic', label: '발랄한 톤' },
                { value: 'male', label: '남성' },
                { value: 'female', label: '여성' },
              ]}
              value={voiceStyle}
              onChange={(e) => setVoiceStyle(e.target.value as any)}
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSubtitles}
                onChange={(e) => setIncludeSubtitles(e.target.checked)}
                className="rounded border-gray-300"
              />
              자막 자동 생성
            </label>

            <Button
              className="w-full"
              variant="secondary"
              onClick={() => generateVideoMutation.mutate()}
              loading={isProcessing}
            >
              <Video size={16} className="mr-2" />
              쇼츠 생성
            </Button>
          </div>
        </Card>
      </div>

      {/* 결과 캔버스 */}
      <div className="lg:col-span-2">
        <Card variant="bordered" className="h-full">
          <div className="flex items-center justify-between mb-4">
            <CardTitle>생성된 콘텐츠</CardTitle>
            {currentJob && jobStatus && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 size={16} className="animate-spin" />
                생성 중... {jobStatus.progress}%
              </div>
            )}
          </div>

          {generatedCreatives.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {generatedCreatives.map((creative) => (
                <CreativeCard
                  key={creative.id}
                  creative={creative}
                  isSelected={selectedCreatives.some((c) => c.id === creative.id)}
                  onSelect={() => addSelectedCreative(creative)}
                  onExtend={() => extendBackgroundMutation.mutate({ id: creative.id, targetFormat: '9:16' })}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Image size={48} className="mb-4" />
              <p>생성된 콘텐츠가 여기에 표시됩니다</p>
            </div>
          )}
        </Card>

        {/* 라이브러리 */}
        {library && library.length > 0 && (
          <Card variant="bordered" className="mt-6">
            <CardTitle className="mb-4">광고 라이브러리</CardTitle>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {library.slice(0, 10).map((creative) => (
                <div
                  key={creative.id}
                  className={`relative rounded-lg overflow-hidden aspect-square cursor-pointer border-2 transition-colors ${
                    selectedCreatives.some((c) => c.id === creative.id)
                      ? 'border-primary-500'
                      : 'border-transparent hover:border-gray-300'
                  }`}
                  onClick={() => addSelectedCreative(creative)}
                >
                  <img
                    src={creative.thumbnail_url || creative.file_url || '/placeholder.png'}
                    alt={creative.name}
                    className="w-full h-full object-cover"
                  />
                  {selectedCreatives.some((c) => c.id === creative.id) && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {selectedCreatives.length > 0 && (
              <p className="mt-3 text-sm text-primary-600">
                {selectedCreatives.length}개 선택됨 - 캠페인에서 사용 가능
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function CreativeCard({
  creative,
  isSelected,
  onSelect,
  onExtend,
}: {
  creative: Creative;
  isSelected: boolean;
  onSelect: () => void;
  onExtend: () => void;
}) {
  return (
    <div className={`relative rounded-lg overflow-hidden border-2 ${isSelected ? 'border-primary-500' : 'border-gray-200'}`}>
      <div className="aspect-square bg-gray-100">
        <img
          src={creative.file_url || creative.thumbnail_url || '/placeholder.png'}
          alt={creative.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-3">
        <p className="text-sm font-medium truncate">{creative.name}</p>
        <p className="text-xs text-gray-500">{creative.format} • {creative.creative_type}</p>
        <div className="flex gap-2 mt-2">
          <Button size="sm" variant={isSelected ? 'primary' : 'outline'} onClick={onSelect} className="flex-1">
            {isSelected ? <Check size={14} className="mr-1" /> : null}
            {isSelected ? '선택됨' : '선택'}
          </Button>
          {creative.format === '1:1' && (
            <Button size="sm" variant="ghost" onClick={onExtend} title="9:16으로 확장">
              <Expand size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
