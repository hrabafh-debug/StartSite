// DTO pro HTTP API backendu. Odpovídají typům v shared/src/index.ts.
namespace StartSite.Desktop.Models;

public sealed class PortOwner
{
    public int Pid { get; set; }
    public string Name { get; set; } = "";
}

public sealed class RuntimeInfo
{
    public string Status { get; set; } = "stopped";
    public int? Pid { get; set; }
    public string? StartedAt { get; set; }
    public string? Error { get; set; }
    public PortOwner? PortOwner { get; set; }
    public int? SuggestedPort { get; set; }
}

public sealed class ProjectDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public string Kind { get; set; } = "npm";
    public string? Script { get; set; }
    public string? Command { get; set; }
    public string? Framework { get; set; }
    public int Port { get; set; }
    public int? ContainerPort { get; set; }
    public string? Service { get; set; }
    public Dictionary<string, string> Env { get; set; } = new();
    public RuntimeInfo Runtime { get; set; } = new();
    public string Url { get; set; } = "";
    public string ResolvedCommand { get; set; } = "";
}

/// <summary>Tělo pro přidání i úpravu. Null hodnoty se neposílají.</summary>
public sealed class ProjectInput
{
    public string? Name { get; set; }
    public string? Path { get; set; }
    public string? Kind { get; set; }
    public string? Script { get; set; }
    public string? Command { get; set; }
    public string? Framework { get; set; }
    public int? Port { get; set; }
    public int? ContainerPort { get; set; }
    public string? Service { get; set; }
    public Dictionary<string, string>? Env { get; set; }
}

public sealed class LogLineDto
{
    public long Seq { get; set; }
    public long Ts { get; set; }
    public string Stream { get; set; } = "stdout";
    public string Text { get; set; } = "";
    public bool Error { get; set; }
}

public sealed class LogsResponse
{
    public ProjectDto? Project { get; set; }
    public List<LogLineDto> Lines { get; set; } = new();
}

public sealed class ServiceInfo
{
    public string Name { get; set; } = "";
    public int? ContainerPort { get; set; }
}

public sealed class DetectResult
{
    public string Path { get; set; } = "";
    public bool Exists { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "custom";
    public Dictionary<string, string> Scripts { get; set; } = new();
    public string? DefaultScript { get; set; }
    public string? Framework { get; set; }
    public List<ServiceInfo> Services { get; set; } = new();
    public string? Service { get; set; }
    public int? ContainerPort { get; set; }
}

public sealed class PortCheck
{
    public int Port { get; set; }
    public bool Free { get; set; }
    public PortOwner? Owner { get; set; }
    public string? Project { get; set; }
}

public sealed class FreePort
{
    public int Port { get; set; }
}

public sealed class ApiError
{
    public string Error { get; set; } = "";
    public string Message { get; set; } = "";
    public PortOwner? Owner { get; set; }
    public int? SuggestedPort { get; set; }
}

public sealed class ServerEvent
{
    public string Type { get; set; } = "";
    public ProjectDto? Project { get; set; }
    public string? Id { get; set; }
    public LogLineDto? Line { get; set; }
}
