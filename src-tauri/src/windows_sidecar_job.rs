//! Windows-native sidecar lifetime management.
//!
//! The JS plugin starts the sidecar as a direct child of our Tauri host.
//! Attach only that child to a Job Object with KILL_ON_JOB_CLOSE. Windows
//! terminates the sidecar if the host exits or crashes. No shell process,
//! extra console window or sidecar event-loop timer is needed.

use std::{
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    sync::{Mutex, OnceLock},
};

use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        },
    },
};

static SIDECAR_JOB: OnceLock<Mutex<Option<OwnedHandle>>> = OnceLock::new();

fn os_error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}

fn is_our_sidecar(pid: u32) -> Result<bool, String> {
    // Never let a caller attach arbitrary user processes to a terminating job.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(os_error("CreateToolhelp32Snapshot"));
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot) };
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut found = unsafe { Process32FirstW(snapshot.as_raw_handle() as HANDLE, &mut entry) } != 0;
    while found {
        if entry.th32ProcessID == pid {
            let end = entry
                .szExeFile
                .iter()
                .position(|&ch| ch == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            return Ok(entry.th32ParentProcessID == std::process::id()
                && name.eq_ignore_ascii_case("beadbox-sidecar.exe"));
        }
        found = unsafe { Process32NextW(snapshot.as_raw_handle() as HANDLE, &mut entry) } != 0;
    }
    Ok(false)
}

fn create_job() -> Result<OwnedHandle, String> {
    let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if raw.is_null() {
        return Err(os_error("CreateJobObjectW"));
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let result = unsafe {
        SetInformationJobObject(
            job.as_raw_handle() as HANDLE,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if result == 0 {
        return Err(os_error("SetInformationJobObject"));
    }
    Ok(job)
}

pub fn adopt(pid: u32) -> Result<(), String> {
    if pid == 0 || !is_our_sidecar(pid)? {
        return Err(format!(
            "sidecar process {pid} is not a direct Beadbox child"
        ));
    }

    let process = unsafe {
        OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        )
    };
    if process.is_null() {
        return Err(os_error("OpenProcess(sidecar)"));
    }
    let process = unsafe { OwnedHandle::from_raw_handle(process) };

    let lock = SIDECAR_JOB.get_or_init(|| Mutex::new(None));
    let mut guard = lock
        .lock()
        .map_err(|_| "sidecar job mutex poisoned".to_owned())?;
    if guard.is_none() {
        *guard = Some(create_job()?);
    }
    let job = guard.as_ref().expect("job initialized");
    if unsafe {
        AssignProcessToJobObject(
            job.as_raw_handle() as HANDLE,
            process.as_raw_handle() as HANDLE,
        )
    } == 0
    {
        return Err(os_error("AssignProcessToJobObject"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn refuses_own_process_and_invalid_pid() {
        assert!(adopt(std::process::id()).is_err());
        assert!(adopt(0).is_err());
        assert!(adopt(u32::MAX).is_err());
    }

    #[test]
    fn closing_job_handle_terminates_child_without_shell() {
        // A short-lived, windowless OS process verifies actual kernel job
        // semantics without starting Beadbox or touching any user workspace.
        let mut child = Command::new("ping.exe")
            .args(["-n", "30", "127.0.0.1"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("launch Windows ping fixture");
        let job = create_job().expect("create native Windows job");
        if unsafe {
            AssignProcessToJobObject(
                job.as_raw_handle() as HANDLE,
                child.as_raw_handle() as HANDLE,
            )
        } == 0
        {
            let _ = child.kill();
            panic!("{}", os_error("AssignProcessToJobObject(test)"));
        }

        drop(job); // simulated Tauri host exit or crash
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut exited = false;
        while Instant::now() < deadline {
            if child.try_wait().expect("query ping fixture").is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }
        if !exited {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(
            exited,
            "child survived after closing its last Job Object handle"
        );
    }
}
