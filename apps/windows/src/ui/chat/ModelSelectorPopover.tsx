import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Check,
  Star,
  Cpu,
  Sparkles,
  Zap,
  Wrench,
  Eye,
  Layers,
  Clock,
  HelpCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import type { ModelDescriptor } from '../../api/client.ts';

interface ModelSelectorPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = ({
  isOpen,
  onClose,
  anchorRef,
}) => {
  const {
    models,
    selectedModel,
    setSelectedModel,
    favoriteModels,
    toggleFavoriteModel,
    userDefaultModel,
    setUserDefaultModel,
    modelCatalogUnavailable,
    modelCatalogError,
    refreshModels,
  } = useAgentStore();

  const [search, setSearch] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  // Reset search when opening
  useEffect(() => {
    if (isOpen) setSearch('');
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(query) ||
        m.provider.toLowerCase().includes(query),
    );
  }, [models, search]);

  const { favorites, groupedByProvider } = useMemo(() => {
    const favSet = new Set(favoriteModels);
    const favList: ModelDescriptor[] = [];
    const groups: Record<string, ModelDescriptor[]> = {};

    for (const model of filteredModels) {
      if (favSet.has(model.id)) {
        favList.push(model);
      }
      const provider = model.provider || 'Lainnya';
      if (!groups[provider]) groups[provider] = [];
      groups[provider]!.push(model);
    }

    return { favorites: favList, groupedByProvider: groups };
  }, [filteredModels, favoriteModels]);

  if (!isOpen) return null;

  const formatContext = (tokens?: number) => {
    if (!tokens) return null;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return `${tokens}`;
  };

  const handleSelect = (modelId: string) => {
    setSelectedModel(modelId);
    onClose();
  };

  const handleSetDefault = async (e: React.MouseEvent, modelId: string | null) => {
    e.stopPropagation();
    await setUserDefaultModel(modelId);
  };

  const handleToggleFavorite = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    toggleFavoriteModel(modelId);
  };

  const renderCapabilityBadges = (model: ModelDescriptor) => {
    const details = model.capabilityDetails;
    const isStreamingVerified =
      details?.streaming?.status === 'probed' ||
      model.capabilities.includes('streaming');
    const isToolsVerified =
      details?.tool_calling?.status === 'probed' ||
      model.capabilities.includes('tool_calling');
    const isVisionVerified =
      details?.vision?.status === 'probed' ||
      model.capabilities.includes('vision');

    const hasUnknown =
      details &&
      (details.streaming?.status === 'unknown' ||
        details.tool_calling?.status === 'unknown' ||
        details.vision?.status === 'unknown');

    return (
      <div className="model-badges-row">
        {isStreamingVerified && (
          <span className="model-cap-badge verified" title="Streaming Terverifikasi">
            <Zap size={10} />
            <span>Stream</span>
          </span>
        )}
        {isToolsVerified && (
          <span className="model-cap-badge verified" title="Pemanggilan Fungsi/Tools Terverifikasi">
            <Wrench size={10} />
            <span>Tools</span>
          </span>
        )}
        {isVisionVerified && (
          <span className="model-cap-badge verified" title="Vision/Multimodal Terverifikasi">
            <Eye size={10} />
            <span>Vision</span>
          </span>
        )}
        {hasUnknown && (
          <span className="model-cap-badge unknown" title="Beberapa kapabilitas belum terbukti (unknown)">
            <HelpCircle size={10} />
            <span>Unknown</span>
          </span>
        )}
        {model.contextWindow && (
          <span className="model-cap-badge context" title={`Kapasitas Konteks: ${model.contextWindow.toLocaleString()} token`}>
            <Layers size={10} />
            <span>{formatContext(model.contextWindow)}</span>
          </span>
        )}
        {typeof model.lastLatencyMs === 'number' && model.lastLatencyMs > 0 && (
          <span className="model-cap-badge latency" title={`Latensi Terakhir: ${model.lastLatencyMs} ms`}>
            <Clock size={10} />
            <span>{model.lastLatencyMs}ms</span>
          </span>
        )}
      </div>
    );
  };

  const renderModelRow = (model: ModelDescriptor) => {
    const isSelected = selectedModel === model.id;
    const isFavorite = favoriteModels.includes(model.id);
    const isUserDefault = userDefaultModel === model.id || model.isDefault;

    return (
      <div
        key={model.id}
        className={`model-popover-item ${isSelected ? 'selected' : ''}`}
        onClick={() => handleSelect(model.id)}
        role="button"
        tabIndex={0}
      >
        <div className="model-item-main">
          <div className="model-item-title-row">
            <span className="model-name-text">{model.id}</span>
            {isUserDefault && (
              <span className="model-default-badge" title="Model default akun Anda">
                Default Akun
              </span>
            )}
          </div>
          {renderCapabilityBadges(model)}
        </div>

        <div className="model-item-actions">
          <button
            type="button"
            className={`model-action-icon-btn ${isFavorite ? 'favorited' : ''}`}
            onClick={(e) => handleToggleFavorite(e, model.id)}
            title={isFavorite ? 'Hapus dari favorit' : 'Sematkan ke favorit'}
            aria-label="Toggle favorit"
          >
            <Star size={13} fill={isFavorite ? 'var(--accent-amber, #f59e0b)' : 'none'} color={isFavorite ? 'var(--accent-amber, #f59e0b)' : 'var(--text-sub)'} />
          </button>

          {!isUserDefault && (
            <button
              type="button"
              className="model-set-default-btn"
              onClick={(e) => void handleSetDefault(e, model.id)}
              title="Atur sebagai model default akun Anda"
            >
              Jadikan Default
            </button>
          )}

          {isSelected && (
            <Check size={14} color="var(--accent-blue)" className="model-selected-check" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="model-selector-popover-card" ref={popoverRef}>
      {/* Search Header */}
      <div className="model-popover-header">
        <div className="model-search-box">
          <Search size={14} color="var(--text-sub)" />
          <input
            type="text"
            className="model-search-input"
            placeholder="Cari model atau provider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="model-search-clear"
              onClick={() => setSearch('')}
              title="Hapus pencarian"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Catalog Offline Banner */}
      {modelCatalogUnavailable && (
        <div className="model-popover-alert" role="alert">
          <span className="model-alert-text">
            {modelCatalogError || 'Katalog model tidak dapat dihubungi (503).'}
          </span>
          <button
            type="button"
            className="model-alert-retry"
            onClick={() => void refreshModels()}
          >
            <RefreshCw size={11} />
            <span>Coba lagi</span>
          </button>
        </div>
      )}

      {/* Models List Scroll Area */}
      <div className="model-popover-list-scroll">
        {/* Auto Entry (Always at Top) */}
        {(!search || 'auto'.includes(search.toLowerCase()) || 'disarankan'.includes(search.toLowerCase())) && (
          <div
            className={`model-popover-item auto-entry ${selectedModel === 'auto' ? 'selected' : ''}`}
            onClick={() => handleSelect('auto')}
            role="button"
            tabIndex={0}
          >
            <div className="model-item-main">
              <div className="model-item-title-row">
                <Sparkles size={14} color="var(--accent-cyan)" />
                <strong className="model-name-text">Auto (Direkomendasikan)</strong>
                <span className="model-recommended-pill">Disarankan</span>
              </div>
              <p className="model-auto-desc">
                Sistem memilih model terbaik secara cerdas sesuai mode & kebutuhan tugas.
              </p>
            </div>
            {selectedModel === 'auto' && (
              <Check size={14} color="var(--accent-blue)" className="model-selected-check" />
            )}
          </div>
        )}

        {/* Favorites Section */}
        {favorites.length > 0 && (
          <div className="model-group-section">
            <div className="model-group-title">
              <Star size={11} fill="var(--accent-amber, #f59e0b)" color="var(--accent-amber, #f59e0b)" />
              <span>Favorit Disematkan</span>
            </div>
            {favorites.map((model) => renderModelRow(model))}
          </div>
        )}

        {/* Grouped by Provider */}
        {Object.keys(groupedByProvider).map((provider) => {
          const list = groupedByProvider[provider]!;
          if (list.length === 0) return null;
          return (
            <div key={provider} className="model-group-section">
              <div className="model-group-title">
                <Cpu size={11} color="var(--text-sub)" />
                <span>{provider.toUpperCase()}</span>
                <span className="model-group-count">({list.length})</span>
              </div>
              {list.map((model) => renderModelRow(model))}
            </div>
          );
        })}

        {filteredModels.length === 0 && search && (
          <div className="model-empty-search">
            Tidak ada model yang cocok dengan kata kunci &quot;{search}&quot;.
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="model-popover-footer">
        <span className="model-count-text">
          {models.length} model tersedia
        </span>
        <button
          type="button"
          className="model-refresh-btn"
          onClick={() => void refreshModels()}
          title="Segarkan katalog model dari server"
        >
          <RefreshCw size={11} />
          <span>Segarkan</span>
        </button>
      </div>
    </div>
  );
};
